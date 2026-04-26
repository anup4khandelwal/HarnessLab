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
  const resolved: ResolvedInferenceRequest = {
    decodeLatencyMs: request.decodeLatencyMs ?? 4,
    generationPlan: [...(request.generationPlan ?? defaultGenerationPlan(request.prompt))],
    id: request.id,
    kvCache,
    maxTokens: request.maxTokens,
    metrics,
    model: request.model ?? "simulated-transformer",
    prefillLatencyMs: request.prefillLatencyMs ?? Math.max(20, promptTokens.length * 8),
    pricing: request.pricing ?? {},
    prompt: request.prompt,
    replayRecorder: request.replayRecorder,
    stopTokens: request.stopTokens ?? ["<eos>"]
  };

  metrics.start({
    pricing: resolved.pricing,
    promptTokens: promptTokens.length,
    requestId: resolved.id
  });

  const startedAtMs = performance.now();
  await sleep(resolved.prefillLatencyMs);

  promptTokens.forEach((token, index) => {
    resolved.kvCache.add({
      position: index,
      requestId: resolved.id,
      token
    });
  });

  resolved.replayRecorder?.recordEvent({
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

