import { AgentRuntime, HybridMemory, LoopDetector, SafeMathModel, createBaseTools } from "@harnesslab/core";
import type { AgentRunResult, LearningModule, RuntimeState, TraceEvent, Tracer } from "@harnesslab/core";
import { AllowAllPolicy, DefaultVerifier } from "@harnesslab/core";

const ENABLE_TRACING = false;

class SilentTracer implements Tracer {
  public async completeRun(_result: AgentRunResult): Promise<void> {}
  public async recordEvent(_event: TraceEvent): Promise<void> {}
  public async recordFailure(_runId: string, _error: Error, _step: number): Promise<void> {}
  public async startRun(_state: RuntimeState): Promise<void> {}
}

export const observabilityModule: LearningModule = {
  description: "Highlights why traces are part of the harness, not an afterthought.",
  failureMode: "The agent works, but the operator has no trace data to debug it.",
  async run() {
    const memory = new HybridMemory();
    const tracer = ENABLE_TRACING
      ? new (await import("@harnesslab/core")).InMemoryTracer()
      : new SilentTracer();

    const runtime = new AgentRuntime({
      autoEscalateOnLoop: true,
      loopDetector: new LoopDetector(),
      memory,
      model: new SafeMathModel(),
      policy: new AllowAllPolicy(),
      stepLimit: 4,
      tokenBudget: 256,
      tools: createBaseTools(memory),
      tracer,
      verifier: new DefaultVerifier()
    });

    const result = await runtime.run({
      goal: "Solve 2 + 2 and expose a trace."
    });
    const traceEvents = "listRuns" in tracer ? tracer.listRuns().flatMap((run) => run.events).length : 0;

    return {
      detail: ENABLE_TRACING
        ? "Tracing enabled. Every step is now inspectable."
        : "Failure demo: the runtime completed, but no traces were recorded. Replace SilentTracer with InMemoryTracer to fix it.",
      result: {
        output: result.output ?? null,
        reason: result.reason,
        status: result.status,
        traceEvents
      },
      status: ENABLE_TRACING ? "success" : "failure_demo"
    };
  },
  slug: "06_observability",
  title: "06 Observability"
};

export default observabilityModule;

