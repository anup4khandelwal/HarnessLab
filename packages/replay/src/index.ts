export type ReplayValue = boolean | null | number | string | ReplayValue[] | ReplayObject;

export interface ReplayObject {
  [key: string]: ReplayValue;
}

export type ReplayStepKind = "decision" | "event" | "token" | "tool_call";

export interface ReplayStep {
  id: string;
  kind: ReplayStepKind;
  payload: ReplayObject;
  timestampMs: number;
}

export interface ReplayTrace {
  endedAtMs: number | undefined;
  startedAtMs: number;
  steps: ReplayStep[];
  traceId: string;
}

export interface ReplayOptions {
  delayMs?: number;
}

export class ReplayRecorder {
  private endedAtMs: number | undefined;
  private readonly startedAtMs = performance.now();
  private readonly steps: ReplayStep[] = [];
  private readonly traceId: string;

  public constructor(traceId = `replay_${Date.now().toString(36)}`) {
    this.traceId = traceId;
  }

  public recordDecision(payload: ReplayObject): ReplayStep {
    return this.recordStep("decision", payload);
  }

  public recordEvent(payload: ReplayObject): ReplayStep {
    return this.recordStep("event", payload);
  }

  public recordToken(payload: ReplayObject): ReplayStep {
    return this.recordStep("token", payload);
  }

  public recordToolCall(payload: ReplayObject): ReplayStep {
    return this.recordStep("tool_call", payload);
  }

  public finish(): ReplayTrace {
    this.endedAtMs = performance.now();
    return this.snapshot();
  }

  public snapshot(): ReplayTrace {
    return {
      endedAtMs: this.endedAtMs,
      startedAtMs: this.startedAtMs,
      steps: [...this.steps],
      traceId: this.traceId
    };
  }

  private recordStep(kind: ReplayStepKind, payload: ReplayObject): ReplayStep {
    const step: ReplayStep = {
      id: `${this.traceId}:${this.steps.length + 1}`,
      kind,
      payload,
      timestampMs: performance.now()
    };

    this.steps.push(step);
    return step;
  }
}

export class ReplayPlayer {
  public async *replay(trace: ReplayTrace, options: ReplayOptions = {}): AsyncGenerator<ReplayStep> {
    const delayMs = options.delayMs ?? 0;

    for (const step of trace.steps) {
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      yield step;
    }
  }
}

const sleep = async (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

