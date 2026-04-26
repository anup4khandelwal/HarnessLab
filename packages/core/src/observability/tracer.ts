import { nowIso } from "../common";
import type { JsonValue } from "../common";
import type { AgentRunResult, RuntimeState } from "../agent/runtime";

export interface TraceEvent {
  payload: JsonValue;
  runId: string;
  step: number;
  timestamp: string;
  type: string;
}

export interface TraceRun {
  completedAt: string | undefined;
  events: TraceEvent[];
  startedAt: string;
  status: string;
  summary: string | undefined;
  traceId: string;
}

export interface Tracer {
  completeRun(result: AgentRunResult): Promise<void>;
  recordEvent(event: TraceEvent): Promise<void>;
  recordFailure(runId: string, error: Error, step: number): Promise<void>;
  startRun(state: RuntimeState): Promise<void>;
}

export class InMemoryTracer implements Tracer {
  private readonly runs = new Map<string, TraceRun>();

  public listRuns(): TraceRun[] {
    return [...this.runs.values()];
  }

  public getRun(traceId: string): TraceRun | undefined {
    return this.runs.get(traceId);
  }

  public async startRun(state: RuntimeState): Promise<void> {
    this.runs.set(state.runId, {
      completedAt: undefined,
      events: [],
      startedAt: state.startedAt,
      status: "running",
      summary: undefined,
      traceId: state.runId
    });
  }

  public async recordEvent(event: TraceEvent): Promise<void> {
    const trace = this.runs.get(event.runId);

    if (trace !== undefined) {
      trace.events.push(event);
    }
  }

  public async recordFailure(runId: string, error: Error, step: number): Promise<void> {
    await this.recordEvent({
      payload: {
        message: error.message,
        name: error.name
      },
      runId,
      step,
      timestamp: nowIso(),
      type: "failure"
    });
  }

  public async completeRun(result: AgentRunResult): Promise<void> {
    const trace = this.runs.get(result.state.runId);

    if (trace === undefined) {
      return;
    }

    trace.completedAt = result.state.completedAt;
    trace.status = result.status;
    trace.summary = result.reason;
  }
}
