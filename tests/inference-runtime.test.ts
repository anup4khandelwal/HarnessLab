import { describe, expect, test } from "bun:test";
import { InferenceRuntime } from "@harnesslab/inference-runtime";

const collectEvents = async (runtime: InferenceRuntime, requestId: string) => {
  const events = [];

  for await (const event of runtime.stream(requestId)) {
    events.push(event);
  }

  return events;
};

describe("InferenceRuntime", () => {
  test("submits, batches, streams, and replays requests", async () => {
    const runtime = new InferenceRuntime({
      batchingWindowMs: 1_000,
      defaultMaxTokens: 6
    });
    const request = runtime.submit({
      generationPlan: ["Harnesses", "coordinate", "<eos>"],
      prefillLatencyMs: 1,
      prompt: "Why do harnesses matter?",
      stopTokens: ["<eos>"]
    });
    const stream = collectEvents(runtime, request.id);

    await runtime.processPendingBatch();

    const events = await stream;
    const state = runtime.getRequestState(request.id);
    const replay = runtime.getReplay(request.id);
    const batches = runtime.getBatchHistory();

    expect(events[0]?.type).toBe("request_submitted");
    expect(events.some((event) => event.type === "request_batched")).toBe(true);
    expect(events.some((event) => event.type === "request_started")).toBe(true);
    expect(events.some((event) => event.type === "completed")).toBe(true);
    expect(state?.status).toBe("completed");
    expect(state?.finishReason).toBe("stop_token");
    expect(state?.outputText).toBe("Harnesses coordinate");
    expect(replay?.trace.steps.length).toBeGreaterThan(0);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.size).toBe(1);
  });

  test("records multi-request batches", async () => {
    const runtime = new InferenceRuntime({
      batchingWindowMs: 1_000,
      defaultMaxTokens: 4
    });
    const first = runtime.submit({
      generationPlan: ["A", "<eos>"],
      prefillLatencyMs: 1,
      prompt: "First",
      stopTokens: ["<eos>"]
    });
    const second = runtime.submit({
      generationPlan: ["B", "<eos>"],
      prefillLatencyMs: 1,
      prompt: "Second",
      stopTokens: ["<eos>"]
    });
    const firstStream = collectEvents(runtime, first.id);
    const secondStream = collectEvents(runtime, second.id);

    await runtime.processPendingBatch();
    await Promise.all([firstStream, secondStream]);

    const batches = runtime.getBatchHistory();

    expect(batches).toHaveLength(1);
    expect(batches[0]?.size).toBe(2);
    expect(batches[0]?.requestIds).toEqual([first.id, second.id]);
    expect(Object.keys(batches[0]?.queueTimeMsByRequestId ?? {})).toHaveLength(2);
  });

  test("cancels queued requests before they are batched", async () => {
    const runtime = new InferenceRuntime({
      batchingWindowMs: 1_000
    });
    const request = runtime.submit({
      prompt: "Cancel me before decode starts"
    });
    const cancelled = runtime.cancel(request.id);
    const events = await collectEvents(runtime, request.id);

    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.finishReason).toBe("cancelled");
    expect(events.some((event) => event.type === "request_cancelled")).toBe(true);
    expect(runtime.getBatchHistory()).toHaveLength(0);
    expect(runtime.pendingCount()).toBe(0);
  });
});
