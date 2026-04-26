import { hashValue } from "../common";
import type { JsonValue } from "../common";

export interface LoopSignal {
  kind: "no_progress" | "repeated_tool";
  message: string;
}

export interface LoopDetectorOptions {
  noProgressThreshold?: number;
  repeatedToolThreshold?: number;
}

export interface LoopSnapshot {
  stateFingerprint: JsonValue;
  toolSignature: string | undefined;
}

export class LoopDetector {
  private readonly noProgressThreshold: number;
  private readonly repeatedToolThreshold: number;
  private lastFingerprint?: string;
  private stagnantSteps = 0;
  private repeatedToolSteps = 0;
  private lastToolSignature?: string;

  public constructor(options: LoopDetectorOptions = {}) {
    this.noProgressThreshold = options.noProgressThreshold ?? 2;
    this.repeatedToolThreshold = options.repeatedToolThreshold ?? 2;
  }

  public record(snapshot: LoopSnapshot): LoopSignal | null {
    const currentFingerprint = hashValue(snapshot.stateFingerprint);

    if (currentFingerprint === this.lastFingerprint) {
      this.stagnantSteps += 1;
    } else {
      this.stagnantSteps = 0;
      this.lastFingerprint = currentFingerprint;
    }

    if (snapshot.toolSignature !== undefined) {
      if (snapshot.toolSignature === this.lastToolSignature) {
        this.repeatedToolSteps += 1;
      } else {
        this.repeatedToolSteps = 0;
        this.lastToolSignature = snapshot.toolSignature;
      }
    }

    if (this.repeatedToolSteps >= this.repeatedToolThreshold) {
      return {
        kind: "repeated_tool",
        message: `Repeated tool signature detected ${this.repeatedToolSteps + 1} times`
      };
    }

    if (this.stagnantSteps >= this.noProgressThreshold) {
      return {
        kind: "no_progress",
        message: `State fingerprint has not changed for ${this.stagnantSteps + 1} steps`
      };
    }

    return null;
  }
}
