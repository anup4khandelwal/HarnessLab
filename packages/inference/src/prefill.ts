import { RequestMetricsTracker } from "@harnesslab/metrics";
import { KvCacheSimulator } from "@harnesslab/memory";
import type { PrefillEvent, PrefillState, ResolvedInferenceRequest, InferenceRequest } from "./types";

export const prefill = async (request: InferenceRequest): Promise<{
  event: PrefillEvent;
  state: PrefillState;
}> => {
  const promptTokens = tokenize(request.prompt);
  const metrics = request.metrics ?? new RequestMetricsTracker();
  const kvCache =
    request.kvCache ??
    new KvCacheSimulator({
      maxBytes: 1_000_000,
      windowSizeTokens: 256
    });

  // Check the shared prefix cache before resolving latency.
  // Tokens matched from a prior request skip re-computation, reducing
  // both prefill latency and cost (cached tokens use a lower price tier).
  const prefixLookup = request.prefixCache?.lookup(promptTokens) ?? {
    cachedTokens: 0,
    hitRate: 0,
    matchedEntryId: undefined
  };
  const cachedTokenCount = prefixLookup.cachedTokens;
  const uncachedTokenCount = promptTokens.length - cachedTokenCount;

  // Latency scales with uncached tokens only.
  const effectivePrefillLatencyMs =
    request.prefillLatencyMs !== undefined
      ? request.prefillLatencyMs * (uncachedTokenCount / Math.max(promptTokens.length, 1))
      : Math.max(2, uncachedTokenCount * 8);

  const resolved: ResolvedInferenceRequest = {
    decodeLatencyMs: request.decodeLatencyMs ?? 4,
    generationPlan: [...(request.generationPlan ?? defaultGenerationPlan(request.prompt))],
    id: request.id,
    kvCache,
    maxTokens: request.maxTokens,
    metrics,
    model: request.model ?? "simulated-transformer",
    prefillLatencyMs: effectivePrefillLatencyMs,
    pricing: request.pricing ?? {},
    prompt: request.prompt,
    replayRecorder: request.replayRecorder,
    stopTokens: request.stopTokens ?? ["<eos>"]
  };

  metrics.start({
    cachedPromptTokens: cachedTokenCount,
    pricing: resolved.pricing,
    promptTokens: promptTokens.length,
    requestId: resolved.id
  });

  const startedAtMs = performance.now();
  await sleep(effectivePrefillLatencyMs);

  promptTokens.forEach((token, index) => {
    resolved.kvCache.add({
      position: index,
      requestId: resolved.id,
      token
    });
  });

  // Register this prompt in the shared prefix cache so subsequent requests
  // with a matching prefix can benefit from the hit.
  request.prefixCache?.store(promptTokens);

  resolved.replayRecorder?.recordEvent({
    cachedTokens: cachedTokenCount,
    model: resolved.model,
    phase: "prefill",
    promptTokens: promptTokens.length,
    requestId: resolved.id
  });

  const state: PrefillState = {
    done: false,
    finishReason: undefined,
    metrics,
    outputTokens: [],
    prefillCompletedAtMs: performance.now(),
    promptTokens,
    remainingPlan: [...resolved.generationPlan],
    replayRecorder: resolved.replayRecorder,
    request: resolved
  };

  return {
    event: {
      cachedTokens: cachedTokenCount,
      cacheUsage: resolved.kvCache.getUsage(),
      latencyMs: state.prefillCompletedAtMs - startedAtMs,
      metrics: metrics.snapshot(),
      phase: "prefill",
      promptTokens,
      requestId: resolved.id,
      type: "prefill"
    },
    state
  };
};

export const tokenize = (text: string): string[] =>
  text
    .trim()
    .split(/\s+/g)
    .filter((token) => token.length > 0);

const defaultGenerationPlan = (prompt: string): string[] => {
  const normalized = prompt.toLowerCase();

  if (normalized.includes("2 + 2") || normalized.includes("2+2")) {
    return ["The", "answer", "is", "4.", "<eos>"];
  }

  const topicalTokens = tokenize(prompt).slice(0, 6);

  return ["Processed:", ...topicalTokens, "<eos>"];
};

const sleep = async (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
