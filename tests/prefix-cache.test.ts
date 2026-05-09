import { describe, expect, test } from "bun:test";
import { collectInference } from "@harnesslab/inference";
import type { PrefillEvent } from "@harnesslab/inference";
import { PrefixCache } from "@harnesslab/memory";
import { InferenceRuntime } from "@harnesslab/inference-runtime";

const SYSTEM_PROMPT = "You are a helpful assistant. Answer concisely.";

const findPrefill = (events: Awaited<ReturnType<typeof collectInference>>["events"]): PrefillEvent =>
  events.find((e): e is PrefillEvent => e.type === "prefill")!;

describe("PrefixCache", () => {
  test("returns zero cached tokens on first lookup (cache miss)", () => {
    const cache = new PrefixCache();
    const tokens = ["You", "are", "helpful"];
    const result = cache.lookup(tokens);

    expect(result.cachedTokens).toBe(0);
    expect(result.hitRate).toBe(0);
    expect(result.matchedEntryId).toBeUndefined();
    expect(cache.getStats().misses).toBe(1);
    expect(cache.getStats().hits).toBe(0);
  });

  test("returns cached token count after storing the same prefix", () => {
    const cache = new PrefixCache();
    const tokens = ["You", "are", "helpful", "today"];
    cache.store(tokens);

    const result = cache.lookup(tokens);

    expect(result.cachedTokens).toBe(4);
    expect(result.hitRate).toBe(1);
    expect(result.matchedEntryId).toBeDefined();
    expect(cache.getStats().hits).toBe(1);
  });

  test("matches the longest common prefix across stored entries", () => {
    const cache = new PrefixCache();
    cache.store(["A", "B", "C"]);
    cache.store(["A", "B", "C", "D", "E"]);

    // Should match the longer entry (5 tokens)
    const result = cache.lookup(["A", "B", "C", "D", "E", "F"]);

    expect(result.cachedTokens).toBe(5);
  });

  test("returns partial match when new prompt shares only a prefix", () => {
    const cache = new PrefixCache();
    cache.store(["system:", "be", "helpful"]);

    const result = cache.lookup(["system:", "be", "helpful", "and", "concise"]);

    expect(result.cachedTokens).toBe(3);
    expect(result.hitRate).toBeCloseTo(3 / 5, 5);
  });

  test("getStats accumulates hits, misses, and tokens saved", () => {
    const cache = new PrefixCache();
    cache.store(["A", "B", "C"]);

    cache.lookup(["X"]); // miss
    cache.lookup(["A", "B", "C"]); // hit, 3 tokens saved
    cache.lookup(["A", "B"]); // hit, 2 tokens saved

    const stats = cache.getStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(2);
    expect(stats.totalTokensSaved).toBe(5);
    expect(stats.storedEntries).toBe(1);
  });

  test("clear resets all state", () => {
    const cache = new PrefixCache();
    cache.store(["A", "B"]);
    cache.lookup(["A", "B"]);
    cache.clear();

    const stats = cache.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.storedEntries).toBe(0);
    expect(stats.totalTokensSaved).toBe(0);
    expect(cache.lookup(["A", "B"]).cachedTokens).toBe(0);
  });
});

describe("prefix cache in inference", () => {
  test("first request gets no cached tokens and second request with shared prefix does", async () => {
    const cache = new PrefixCache();

    const resultA = await collectInference({
      generationPlan: ["ok.", "<eos>"],
      id: "a",
      maxTokens: 4,
      prefixCache: cache,
      prefillLatencyMs: 10,
      prompt: `${SYSTEM_PROMPT} What is 2+2?`,
      stopTokens: ["<eos>"]
    });

    const resultB = await collectInference({
      generationPlan: ["ok.", "<eos>"],
      id: "b",
      maxTokens: 4,
      prefixCache: cache,
      prefillLatencyMs: 10,
      prompt: `${SYSTEM_PROMPT} What is 3+3?`,
      stopTokens: ["<eos>"]
    });

    const prefillA = findPrefill(resultA.events);
    const prefillB = findPrefill(resultB.events);

    // First request: no cached tokens
    expect(prefillA.cachedTokens).toBe(0);
    expect(resultA.completion.metrics.cachedPromptTokens).toBe(0);

    // Second request: shares the system prompt prefix
    expect(prefillB.cachedTokens).toBeGreaterThan(0);
    expect(resultB.completion.metrics.cachedPromptTokens).toBe(prefillB.cachedTokens);
  });

  test("prefix cache hit reduces prefill latency proportionally", async () => {
    const cache = new PrefixCache();
    const sharedPrefix = "shared prefix tokens here";

    // Warm up the cache
    await collectInference({
      generationPlan: ["<eos>"],
      id: "warm",
      maxTokens: 2,
      prefixCache: cache,
      prefillLatencyMs: 100,
      prompt: `${sharedPrefix} unique query one`,
      stopTokens: ["<eos>"]
    });

    // Second request shares most of the prompt
    const result = await collectInference({
      generationPlan: ["<eos>"],
      id: "cached",
      maxTokens: 2,
      prefixCache: cache,
      prefillLatencyMs: 100,
      prompt: `${sharedPrefix} unique query two`,
      stopTokens: ["<eos>"]
    });

    const prefill = findPrefill(result.events);
    // latency should be less than the full 100ms because prefix tokens are cached
    expect(prefill.latencyMs).toBeLessThan(100);
    expect(prefill.cachedTokens).toBeGreaterThan(0);
  });

  test("cached prompt tokens reduce cost when cachedInputCostPer1KTokens is lower", async () => {
    const cache = new PrefixCache();
    const pricing = {
      cachedInputCostPer1KTokens: 0,   // free for cached
      inputCostPer1KTokens: 1,
      outputCostPer1KTokens: 0
    };

    await collectInference({
      generationPlan: ["<eos>"],
      id: "first",
      maxTokens: 2,
      prefixCache: cache,
      prefillLatencyMs: 1,
      pricing,
      prompt: "long shared system prompt tokens for testing cost",
      stopTokens: ["<eos>"]
    });

    const second = await collectInference({
      generationPlan: ["<eos>"],
      id: "second",
      maxTokens: 2,
      prefixCache: cache,
      prefillLatencyMs: 1,
      pricing,
      prompt: "long shared system prompt tokens for testing cost plus extra",
      stopTokens: ["<eos>"]
    });

    const firstCost = (await collectInference({
      generationPlan: ["<eos>"],
      id: "nocache",
      maxTokens: 2,
      prefillLatencyMs: 1,
      pricing,
      prompt: "long shared system prompt tokens for testing cost plus extra",
      stopTokens: ["<eos>"]
    })).completion.metrics.costUsd;

    // Second request with cache should cost less than without cache
    expect(second.completion.metrics.costUsd).toBeLessThan(firstCost);
    expect(second.completion.metrics.cachedPromptTokens).toBeGreaterThan(0);
  });

  test("InferenceRuntime passes shared PrefixCache across requests", async () => {
    const cache = new PrefixCache();
    const runtime = new InferenceRuntime({
      batchingWindowMs: 1_000,
      defaultMaxTokens: 4,
      prefixCache: cache
    });

    const first = runtime.submit({
      generationPlan: ["result.", "<eos>"],
      prefillLatencyMs: 1,
      prompt: `${SYSTEM_PROMPT} question one`,
      stopTokens: ["<eos>"]
    });

    await runtime.processPendingBatch();
    for await (const _ of runtime.stream(first.id)) { /* drain */ }

    const second = runtime.submit({
      generationPlan: ["result.", "<eos>"],
      prefillLatencyMs: 1,
      prompt: `${SYSTEM_PROMPT} question two`,
      stopTokens: ["<eos>"]
    });

    await runtime.processPendingBatch();
    for await (const _ of runtime.stream(second.id)) { /* drain */ }

    const stats = runtime.getPrefixCacheStats();
    expect(stats).toBeDefined();
    expect(stats!.hits).toBeGreaterThan(0);
    expect(stats!.totalTokensSaved).toBeGreaterThan(0);

    const secondState = runtime.getRequestState(second.id);
    expect(secondState?.metrics.cachedPromptTokens).toBeGreaterThan(0);
  });
});
