export interface PricingModel {
  cachedInputCostPer1KTokens: number;
  inputCostPer1KTokens: number;
  outputCostPer1KTokens: number;
}

export interface MetricsStartOptions {
  cachedPromptTokens?: number;
  pricing?: Partial<PricingModel>;
  promptTokens?: number;
  requestId?: string;
}

export interface RequestMetricsSnapshot {
  cachedPromptTokens: number;
  costUsd: number;
  endedAtMs: number | undefined;
  firstTokenAtMs: number | undefined;
  outputTokens: number;
  promptTokens: number;
  requestId: string | undefined;
  startedAtMs: number | undefined;
  throughputTokensPerSecond: number | undefined;
  tokenTimestampsMs: number[];
  totalLatencyMs: number | undefined;
  totalTokens: number;
  tpotMs: number | undefined;
  ttftMs: number | undefined;
}

const DEFAULT_PRICING: PricingModel = {
  cachedInputCostPer1KTokens: 0,
  inputCostPer1KTokens: 0,
  outputCostPer1KTokens: 0
};

export class RequestMetricsTracker {
  private cachedPromptTokens = 0;
  private endedAtMs: number | undefined;
  private firstTokenAtMs: number | undefined;
  private outputTokens = 0;
  private pricing: PricingModel = DEFAULT_PRICING;
  private promptTokens = 0;
  private requestId: string | undefined;
  private startedAtMs: number | undefined;
  private readonly tokenTimestampsMs: number[] = [];

  public start(options: MetricsStartOptions = {}): void {
    this.cachedPromptTokens = options.cachedPromptTokens ?? 0;
    this.endedAtMs = undefined;
    this.firstTokenAtMs = undefined;
    this.outputTokens = 0;
    this.pricing = {
      ...DEFAULT_PRICING,
      ...options.pricing
    };
    this.promptTokens = options.promptTokens ?? 0;
    this.requestId = options.requestId;
    this.startedAtMs = performance.now();
    this.tokenTimestampsMs.length = 0;
  }

  public addPromptTokens(count: number, cached = false): void {
    if (cached) {
      this.cachedPromptTokens += count;
    }

    this.promptTokens += count;
  }

  public onFirstToken(timestampMs = performance.now()): void {
    if (this.firstTokenAtMs === undefined) {
      this.firstTokenAtMs = timestampMs;
    }
  }

  public onToken(count = 1, timestampMs = performance.now()): void {
    if (this.startedAtMs === undefined) {
      this.start();
    }

    if (this.firstTokenAtMs === undefined) {
      this.onFirstToken(timestampMs);
    }

    for (let index = 0; index < count; index += 1) {
      this.outputTokens += 1;
      this.tokenTimestampsMs.push(timestampMs);
    }
  }

  public end(timestampMs = performance.now()): RequestMetricsSnapshot {
    this.endedAtMs = timestampMs;
    return this.snapshot();
  }

  public snapshot(): RequestMetricsSnapshot {
    const totalTokens = this.promptTokens + this.outputTokens;
    const ttftMs =
      this.startedAtMs !== undefined && this.firstTokenAtMs !== undefined
        ? this.firstTokenAtMs - this.startedAtMs
        : undefined;
    const totalLatencyMs =
      this.startedAtMs !== undefined && this.endedAtMs !== undefined
        ? this.endedAtMs - this.startedAtMs
        : undefined;
    const tpotMs =
      this.firstTokenAtMs !== undefined && this.endedAtMs !== undefined
        ? this.outputTokens <= 1
          ? 0
          : (this.endedAtMs - this.firstTokenAtMs) / (this.outputTokens - 1)
        : undefined;
    const throughputTokensPerSecond =
      this.outputTokens > 0 && totalLatencyMs !== undefined && totalLatencyMs > 0
        ? (this.outputTokens / totalLatencyMs) * 1_000
        : undefined;

    return {
      cachedPromptTokens: this.cachedPromptTokens,
      costUsd: this.calculateCostUsd(),
      endedAtMs: this.endedAtMs,
      firstTokenAtMs: this.firstTokenAtMs,
      outputTokens: this.outputTokens,
      promptTokens: this.promptTokens,
      requestId: this.requestId,
      startedAtMs: this.startedAtMs,
      throughputTokensPerSecond,
      tokenTimestampsMs: [...this.tokenTimestampsMs],
      totalLatencyMs,
      totalTokens,
      tpotMs,
      ttftMs
    };
  }

  private calculateCostUsd(): number {
    const uncachedPromptTokens = Math.max(this.promptTokens - this.cachedPromptTokens, 0);

    return (
      (uncachedPromptTokens / 1_000) * this.pricing.inputCostPer1KTokens +
      (this.cachedPromptTokens / 1_000) * this.pricing.cachedInputCostPer1KTokens +
      (this.outputTokens / 1_000) * this.pricing.outputCostPer1KTokens
    );
  }
}

