import { collectInference } from "@harnesslab/inference";
import type { InferenceRunResult, PrefillEvent } from "@harnesslab/inference";
import { PrefixCache } from "@harnesslab/memory";
import type { LearningModule } from "@harnesslab/core";

// Flip to true to enable the shared prefix cache and see the latency and
// cost savings for the second request, which shares a long system prompt
// with the first.
const ENABLE_PREFIX_CACHE = false;

// A long system prompt that both requests share. In practice this models
// the common "system prompt + N user turns" pattern in production chat APIs
// where the system prompt is identical across thousands of requests.
const SYSTEM_PROMPT =
  "You are an expert mathematics tutor. Always show each step clearly and verify your answer before responding to the student.";

const runRequest = async (id: string, userQuery: string, prefixCache: PrefixCache | undefined) => {
  const prompt = `${SYSTEM_PROMPT} ${userQuery}`;

  return collectInference({
    generationPlan: ["The", "answer", "is", "correct.", "<eos>"],
    id,
    maxTokens: 8,
    // Pricing mirrors Claude 3.5 Sonnet tiers (per 1 K tokens) to make
    // cost savings concrete — cached tokens are 10× cheaper.
    pricing: {
      cachedInputCostPer1KTokens: 0.0003,
      inputCostPer1KTokens: 0.003,
      outputCostPer1KTokens: 0.015
    },
    prompt,
    stopTokens: ["<eos>"],
    ...(prefixCache !== undefined ? { prefixCache } : {})
  });
};

const findPrefill = (result: InferenceRunResult): PrefillEvent | undefined =>
  result.events.find((e): e is PrefillEvent => e.type === "prefill");

export const prefixCacheModule: LearningModule = {
  description:
    "Shows how a shared prompt prefix cache reduces prefill latency and input cost when multiple requests share a common system prompt.",
  failureMode:
    "Without a prefix cache every request pays full prefill cost, even when a long system prompt is identical across requests.",
  async run() {
    const cache = ENABLE_PREFIX_CACHE ? new PrefixCache() : undefined;

    const resultA = await runRequest("req_prefix_a", "What is 8 multiplied by 7?", cache);
    const resultB = await runRequest("req_prefix_b", "What is the cube root of 27?", cache);

    const prefillA = findPrefill(resultA);
    const prefillB = findPrefill(resultB);

    const latencyA = prefillA?.latencyMs ?? 0;
    const latencyB = prefillB?.latencyMs ?? 0;
    const cachedTokensB = prefillB?.cachedTokens ?? 0;
    const costA = resultA.completion.metrics.costUsd;
    const costB = resultB.completion.metrics.costUsd;

    const detail = ENABLE_PREFIX_CACHE
      ? `Prefix cache enabled. Request B reused ${cachedTokensB} cached tokens — prefill dropped from ${latencyA.toFixed(1)} ms to ${latencyB.toFixed(1)} ms and cost fell from $${costA.toFixed(6)} to $${costB.toFixed(6)}.`
      : `Failure demo: both requests paid full prefill cost ($${costA.toFixed(6)} each). Flip ENABLE_PREFIX_CACHE to true to share the system prompt across requests.`;

    return {
      detail,
      result: {
        requestA: {
          cachedTokens: prefillA?.cachedTokens ?? 0,
          cachedPromptTokens: resultA.completion.metrics.cachedPromptTokens,
          costUsd: costA,
          prefillLatencyMs: latencyA
        },
        requestB: {
          cachedTokens: cachedTokensB,
          cachedPromptTokens: resultB.completion.metrics.cachedPromptTokens,
          costUsd: costB,
          prefillLatencyMs: latencyB
        },
        ...(ENABLE_PREFIX_CACHE && cache !== undefined
          ? { prefixCacheStats: cache.getStats() }
          : {})
      },
      status: ENABLE_PREFIX_CACHE ? "success" : "failure_demo"
    };
  },
  slug: "09_prefix_cache",
  title: "09 Prefix Cache"
};

export default prefixCacheModule;
