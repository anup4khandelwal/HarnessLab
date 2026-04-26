import { describe, expect, test } from "bun:test";
import { RuleBasedPolicy, StaticApprovalGate } from "@harnesslab/core";
import { ScenarioEvalEngine } from "@harnesslab/evals";
import { collectInference, runSpeculativeDecode } from "@harnesslab/inference";
import { KvCacheSimulator } from "@harnesslab/memory";
import { RequestMetricsTracker } from "@harnesslab/metrics";
import { ReplayPlayer, ReplayRecorder } from "@harnesslab/replay";
import { RequestScheduler } from "@harnesslab/scheduler";

describe("inference control plane", () => {
  test("collectInference separates prefill and decode and stops on stop token", async () => {
    const replay = new ReplayRecorder("inference_test");
    const result = await collectInference({
      generationPlan: ["Harnesses", "matter", "<eos>", "ignored"],
      id: "req_1",
      kvCache: new KvCacheSimulator({
        evictionStrategy: "sliding_window",
        maxBytes: 2_048,
        windowSizeTokens: 16
      }),
      maxTokens: 10,
      prefillLatencyMs: 1,
      prompt: "Why do harnesses matter?",
      replayRecorder: replay,
      stopTokens: ["<eos>"]
    });

    expect(result.events[0]?.type).toBe("prefill");
    expect(result.events.filter((event) => event.type === "token")).toHaveLength(2);
    expect(result.completion.finishReason).toBe("stop_token");
    expect(result.completion.outputText).toBe("Harnesses matter");
    expect(result.completion.metrics.outputTokens).toBe(2);
    expect(replay.snapshot().steps.length).toBeGreaterThan(0);
  });

  test("RequestMetricsTracker computes TTFT, TPOT, and cost", () => {
    const tracker = new RequestMetricsTracker();
    tracker.start({
      pricing: {
        inputCostPer1KTokens: 0.01,
        outputCostPer1KTokens: 0.02
      },
      promptTokens: 100,
      requestId: "metrics_1"
    });

    const startedAtMs = tracker.snapshot().startedAtMs!;
    tracker.onFirstToken(startedAtMs + 50);
    tracker.onToken(1, startedAtMs + 50);
    tracker.onToken(1, startedAtMs + 80);
    const snapshot = tracker.end(startedAtMs + 100);

    expect(snapshot.ttftMs).toBeCloseTo(50, 6);
    expect(snapshot.tpotMs).toBeCloseTo(50, 6);
    expect(snapshot.totalTokens).toBe(102);
    expect(snapshot.costUsd).toBeCloseTo(0.00104, 6);
  });

  test("KvCacheSimulator evicts least recently used entries when configured", () => {
    const kvCache = new KvCacheSimulator({
      evictionStrategy: "lru",
      maxBytes: 220
    });

    kvCache.add({
      position: 0,
      requestId: "req",
      sizeBytes: 100,
      token: "A"
    });
    kvCache.add({
      position: 1,
      requestId: "req",
      sizeBytes: 100,
      token: "B"
    });
    kvCache.touch("req", 0);
    const result = kvCache.add({
      position: 2,
      requestId: "req",
      sizeBytes: 100,
      token: "C"
    });

    expect(result.evicted).toHaveLength(1);
    expect(result.evicted[0]?.token).toBe("B");
    expect(kvCache.getUsage().tokenCount).toBe(2);
  });

  test("RequestScheduler batches queued work", async () => {
    const scheduler = new RequestScheduler<number, number>({
      batchingWindowMs: 50,
      processBatch: async (batch) => batch.requests.map((request) => request * 2)
    });

    const pending = [scheduler.enqueue(2), scheduler.enqueue(4)];
    const batch = await scheduler.processBatch();
    const resolved = await Promise.all(pending);

    expect(batch?.size).toBe(2);
    expect(resolved[0]?.result).toBe(4);
    expect(resolved[1]?.batchId).toBe(resolved[0]?.batchId);
  });

  test("runSpeculativeDecode reports acceptance rate", async () => {
    const result = await runSpeculativeDecode({
      canonicalTokens: ["A", "B", "C"],
      draftTokens: ["A", "X", "C"],
      verifyWindow: 2
    });

    expect(result.acceptedTokens).toBe(2);
    expect(result.rejectedTokens).toBe(1);
    expect(result.acceptanceRate).toBeCloseTo(2 / 3, 5);
    expect(result.emittedTokens.join(" ")).toBe("A B C");
  });

  test("ReplayPlayer replays recorded steps", async () => {
    const recorder = new ReplayRecorder("replay_test");
    recorder.recordToken({
      requestId: "req",
      token: "hello"
    });
    recorder.recordDecision({
      decision: "allow"
    });
    const trace = recorder.finish();
    const player = new ReplayPlayer();
    const steps: string[] = [];

    for await (const step of player.replay(trace)) {
      steps.push(step.kind);
    }

    expect(steps).toEqual(["token", "decision"]);
  });

  test("ScenarioEvalEngine evaluates inference scenarios", async () => {
    const engine = new ScenarioEvalEngine();
    const report = await engine.run([
      {
        expected: "stop within 2 decoded tokens",
        name: "stop-token",
        run: async () =>
          collectInference({
            generationPlan: ["one", "<eos>"],
            id: "scenario_1",
            maxTokens: 4,
            prefillLatencyMs: 1,
            prompt: "Count once",
            stopTokens: ["<eos>"]
          }),
        validate: (result) => [
          {
            detail: `finishReason=${result.completion.finishReason}`,
            name: "finish-reason",
            passed: result.completion.finishReason === "stop_token"
          },
          {
            detail: `tokens=${result.completion.outputTokens.length}`,
            name: "token-count",
            passed: result.completion.outputTokens.length <= 2
          }
        ]
      }
    ]);

    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
  });

  test("RuleBasedPolicy supports generic actions that require approval", async () => {
    const policy = new RuleBasedPolicy(
      [
        {
          actionKind: "inference",
          effect: "require_approval",
          name: "decode.step",
          reason: "manual checkpoint"
        }
      ],
      new StaticApprovalGate(false)
    );
    const decision = await policy.allows(
      {
        input: {},
        kind: "inference",
        name: "decode.step"
      },
      {
        runId: "run_1",
        step: 1,
        workingMemory: {}
      }
    );

    expect(decision.allowed).toBe(false);
    expect(decision.disposition).toBe("require_approval");
    expect(decision.approval?.status).toBe("denied");
  });
});
