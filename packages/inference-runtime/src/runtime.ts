import { runInference, type CompletionEvent, type InferenceEvent, type InferenceRequest } from "@harnesslab/inference";
import { KvCacheSimulator, type KvCacheOptions } from "@harnesslab/memory";
import { RequestMetricsTracker } from "@harnesslab/metrics";
import { ReplayRecorder } from "@harnesslab/replay";
import { RequestScheduler } from "@harnesslab/scheduler";
import type {
  InferenceRuntimeBatchSnapshot,
  InferenceRuntimeEvent,
  InferenceRuntimeOptions,
  InferenceRuntimeReplaySnapshot,
  InferenceRuntimeRequestInput,
  InferenceRuntimeRequestSnapshot,
  InferenceRuntimeStatus,
  RequestBatchedEvent,
  RequestCancelledEvent,
  RequestCancellationRequestedEvent,
  RequestFailedEvent,
  RequestStartedEvent,
  RequestSubmittedEvent
} from "./types";

interface RequestRecord {
  batchId?: string;
  batchSize?: number;
  cancellationRequested: boolean;
  closed: boolean;
  completedAtMs?: number;
  completion?: CompletionEvent;
  error?: string;
  events: InferenceRuntimeEvent[];
  finishReason?: InferenceRuntimeRequestSnapshot["finishReason"];
  id: string;
  input: InferenceRuntimeRequestInput;
  kvCache: KvCacheSimulator;
  maxTokens: number;
  metrics: RequestMetricsTracker;
  outputText: string;
  outputTokens: string[];
  queueTimeMs?: number;
  replay: ReplayRecorder;
  startedAtMs?: number;
  status: InferenceRuntimeStatus;
  submittedAtMs: number;
  waiters: Set<() => void>;
}

interface BatchResolution {
  batchId: string;
  batchSize: number;
  launchedAtMs: number;
}

const DEFAULT_KV_CACHE_OPTIONS: KvCacheOptions = {
  evictionStrategy: "sliding_window",
  maxBytes: 65_536,
  windowSizeTokens: 128
};

class InferenceRuntimeCancelledError extends Error {
  public constructor(requestId: string) {
    super(`Inference request ${requestId} was cancelled`);
    this.name = "InferenceRuntimeCancelledError";
  }
}

export class InferenceRuntime {
  private readonly batchHistory: InferenceRuntimeBatchSnapshot[] = [];
  private readonly defaultKvCacheOptions: KvCacheOptions;
  private readonly defaultMaxTokens: number;
  private requestCounter = 0;
  private readonly requestIdPrefix: string;
  private readonly requests = new Map<string, RequestRecord>();
  private readonly scheduler: RequestScheduler<string, BatchResolution>;

  public constructor(options: InferenceRuntimeOptions = {}) {
    this.defaultKvCacheOptions = {
      ...DEFAULT_KV_CACHE_OPTIONS,
      ...options.defaultKvCacheOptions
    };
    this.defaultMaxTokens = options.defaultMaxTokens ?? 16;
    this.requestIdPrefix = options.requestIdPrefix ?? "req";
    this.scheduler = new RequestScheduler<string, BatchResolution>({
      batchingWindowMs: options.batchingWindowMs ?? 10,
      maxBatchSize: options.maxBatchSize ?? 8,
      processBatch: async (batch) => {
        const launchedAtMs = performance.now();
        const entry: InferenceRuntimeBatchSnapshot = {
          batchId: batch.batchId,
          launchedAtMs,
          queueTimeMsByRequestId: {},
          requestIds: [...batch.requests],
          size: batch.requests.length
        };

        this.batchHistory.push(entry);

        for (const requestId of batch.requests) {
          const record = this.requests.get(requestId);

          if (record !== undefined) {
            this.emitRuntimeEvent(record, {
              batchId: batch.batchId,
              batchSize: batch.requests.length,
              requestId,
              timestampMs: launchedAtMs,
              type: "request_batched"
            });
          }
        }

        return batch.requests.map(() => ({
          batchId: batch.batchId,
          batchSize: batch.requests.length,
          launchedAtMs
        }));
      }
    });
  }

  public submit(input: InferenceRuntimeRequestInput): InferenceRuntimeRequestSnapshot {
    const id = input.id ?? this.nextRequestId();
    const metrics = input.metrics ?? new RequestMetricsTracker();
    const kvCache = input.kvCache ?? new KvCacheSimulator(this.resolveKvCacheOptions(input.kvCacheOptions));
    const replay = input.replayRecorder ?? new ReplayRecorder(`runtime_${id}`);
    const submittedAtMs = performance.now();
    const record: RequestRecord = {
      cancellationRequested: false,
      closed: false,
      events: [],
      id,
      input: {
        ...input,
        id
      },
      kvCache,
      maxTokens: input.maxTokens ?? this.defaultMaxTokens,
      metrics,
      outputText: "",
      outputTokens: [],
      replay,
      status: "queued",
      submittedAtMs,
      waiters: new Set()
    };

    this.requests.set(id, record);
    this.emitRuntimeEvent(record, {
      maxTokens: record.maxTokens,
      prompt: record.input.prompt,
      requestId: id,
      timestampMs: submittedAtMs,
      type: "request_submitted"
    });

    this.scheduler
      .enqueue(id)
      .then((scheduled) => {
        const active = this.requests.get(id);

        if (active === undefined || active.status !== "queued") {
          return;
        }

        active.batchId = scheduled.batchId;
        active.batchSize = scheduled.result.batchSize;
        active.queueTimeMs = scheduled.queueTimeMs;
        active.startedAtMs = performance.now();
        active.status = "running";
        this.updateBatchHistory(scheduled.batchId, id, scheduled.queueTimeMs);
        this.emitRuntimeEvent(active, {
          batchId: scheduled.batchId,
          batchSize: scheduled.result.batchSize,
          queueTimeMs: scheduled.queueTimeMs,
          requestId: id,
          timestampMs: active.startedAtMs,
          type: "request_started"
        });
        void this.execute(active);
      })
      .catch((error: unknown) => {
        const active = this.requests.get(id);

        if (active === undefined) {
          return;
        }

        if (error instanceof InferenceRuntimeCancelledError) {
          if (active.status === "queued") {
            this.finalizeCancelled(active, "queued");
          }
          return;
        }

        if (active.status !== "cancelled") {
          this.fail(active, error);
        }
      });

    return this.getRequestState(id)!;
  }

  public cancel(requestId: string): InferenceRuntimeRequestSnapshot | undefined {
    const record = this.requests.get(requestId);

    if (record === undefined) {
      return undefined;
    }

    if (this.isTerminal(record.status)) {
      return this.toSnapshot(record);
    }

    const stage = record.status === "queued" ? "queued" : "running";
    record.cancellationRequested = true;
    this.emitRuntimeEvent(record, {
      requestId,
      stage,
      timestampMs: performance.now(),
      type: "request_cancellation_requested"
    });

    if (stage === "queued") {
      const removed = this.scheduler.cancel(
        (queuedRequestId) => queuedRequestId === requestId,
        new InferenceRuntimeCancelledError(requestId)
      );

      if (removed > 0) {
        this.finalizeCancelled(record, "queued");
      }
    }

    return this.toSnapshot(record);
  }

  public getBatchHistory(): InferenceRuntimeBatchSnapshot[] {
    return this.batchHistory.map((entry) => ({
      ...entry,
      queueTimeMsByRequestId: {
        ...entry.queueTimeMsByRequestId
      },
      requestIds: [...entry.requestIds]
    }));
  }

  public getReplay(requestId: string): InferenceRuntimeReplaySnapshot | undefined {
    const record = this.requests.get(requestId);

    if (record === undefined) {
      return undefined;
    }

    return {
      request: this.toSnapshot(record),
      trace: record.replay.snapshot()
    };
  }

  public getRequestState(requestId: string): InferenceRuntimeRequestSnapshot | undefined {
    const record = this.requests.get(requestId);
    return record === undefined ? undefined : this.toSnapshot(record);
  }

  public pendingCount(): number {
    return this.scheduler.pendingCount();
  }

  public async processPendingBatch(): Promise<InferenceRuntimeBatchSnapshot | null> {
    const processed = await this.scheduler.processBatch();

    if (processed === null) {
      return null;
    }

    const batch = this.batchHistory.find((entry) => entry.batchId === processed.batchId);
    return batch === undefined
      ? null
      : {
          ...batch,
          queueTimeMsByRequestId: {
            ...batch.queueTimeMsByRequestId
          },
          requestIds: [...batch.requestIds]
        };
  }

  public async *stream(requestId: string): AsyncGenerator<InferenceRuntimeEvent> {
    const record = this.requests.get(requestId);

    if (record === undefined) {
      throw new Error(`Unknown inference request: ${requestId}`);
    }

    let index = 0;

    while (true) {
      while (index < record.events.length) {
        yield record.events[index]!;
        index += 1;
      }

      if (record.closed) {
        return;
      }

      await new Promise<void>((resolve) => {
        const notify = (): void => {
          record.waiters.delete(notify);
          resolve();
        };

        record.waiters.add(notify);
      });
    }
  }

  private close(record: RequestRecord): void {
    if (record.closed) {
      return;
    }

    record.closed = true;

    for (const waiter of [...record.waiters]) {
      waiter();
    }

    record.waiters.clear();
  }

  private async execute(record: RequestRecord): Promise<void> {
    const request: InferenceRequest = {
      id: record.id,
      kvCache: record.kvCache,
      maxTokens: record.maxTokens,
      metrics: record.metrics,
      prompt: record.input.prompt,
      replayRecorder: record.replay,
      ...(record.input.decodeLatencyMs !== undefined ? { decodeLatencyMs: record.input.decodeLatencyMs } : {}),
      ...(record.input.generationPlan !== undefined ? { generationPlan: record.input.generationPlan } : {}),
      ...(record.input.model !== undefined ? { model: record.input.model } : {}),
      ...(record.input.prefillLatencyMs !== undefined ? { prefillLatencyMs: record.input.prefillLatencyMs } : {}),
      ...(record.input.pricing !== undefined ? { pricing: record.input.pricing } : {}),
      ...(record.input.stopTokens !== undefined ? { stopTokens: record.input.stopTokens } : {})
    };
    const iterator = runInference(request);

    try {
      while (true) {
        const next = await iterator.next();

        if (next.done) {
          break;
        }

        const event = next.value;
        this.emitInferenceEvent(record, event);

        if (record.cancellationRequested && event.type !== "completed") {
          await iterator.return?.(undefined);
          this.finalizeCancelled(record, "running");
          return;
        }
      }

      if (record.status === "running") {
        record.status = "completed";
        record.completedAtMs = performance.now();
        record.finishReason = record.completion?.finishReason;
        this.close(record);
      }
    } catch (error) {
      if (record.cancellationRequested) {
        this.finalizeCancelled(record, "running");
        return;
      }

      this.fail(record, error);
    }
  }

  private emitInferenceEvent(record: RequestRecord, event: InferenceEvent): void {
    record.events.push(event);

    if (event.type === "token") {
      record.outputText = event.outputText;
      record.outputTokens = event.outputText.length === 0 ? [] : event.outputText.split(/\s+/g);
    } else if (event.type === "completed") {
      record.completion = event;
      record.outputText = event.outputText;
      record.outputTokens = [...event.outputTokens];
      record.finishReason = event.finishReason;
      record.completedAtMs = performance.now();
    }

    this.notify(record);
  }

  private emitRuntimeEvent(
    record: RequestRecord,
    event:
      | RequestBatchedEvent
      | RequestCancelledEvent
      | RequestCancellationRequestedEvent
      | RequestFailedEvent
      | RequestStartedEvent
      | RequestSubmittedEvent
  ): void {
    record.events.push(event);
    record.replay.recordEvent({
      requestId: event.requestId,
      timestampMs: event.timestampMs,
      type: event.type,
      ...this.runtimeReplayPayload(event)
    });
    this.notify(record);
  }

  private fail(record: RequestRecord, error: unknown): void {
    if (this.isTerminal(record.status)) {
      return;
    }

    const resolved = error instanceof Error ? error : new Error(String(error));
    record.error = resolved.message;
    record.status = "failed";
    record.finishReason = "failed";
    record.completedAtMs = performance.now();
    record.metrics.end(record.completedAtMs);
    this.emitRuntimeEvent(record, {
      error: resolved.message,
      requestId: record.id,
      timestampMs: record.completedAtMs,
      type: "request_failed"
    });
    record.replay.recordDecision({
      error: resolved.message,
      requestId: record.id,
      result: "failed"
    });
    record.replay.finish();
    this.close(record);
  }

  private finalizeCancelled(record: RequestRecord, stage: "queued" | "running"): void {
    if (this.isTerminal(record.status)) {
      return;
    }

    record.status = "cancelled";
    record.finishReason = "cancelled";
    record.completedAtMs = performance.now();
    record.metrics.end(record.completedAtMs);
    this.emitRuntimeEvent(record, {
      requestId: record.id,
      stage,
      timestampMs: record.completedAtMs,
      type: "request_cancelled"
    });
    record.replay.recordDecision({
      requestId: record.id,
      result: "cancelled",
      stage
    });
    record.replay.finish();
    this.close(record);
  }

  private isTerminal(status: InferenceRuntimeStatus): boolean {
    return status === "cancelled" || status === "completed" || status === "failed";
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `${this.requestIdPrefix}_${this.requestCounter.toString(36)}`;
  }

  private notify(record: RequestRecord): void {
    for (const waiter of [...record.waiters]) {
      waiter();
    }
  }

  private resolveKvCacheOptions(overrides: Partial<KvCacheOptions> | undefined): KvCacheOptions {
    return {
      ...this.defaultKvCacheOptions,
      ...overrides
    };
  }

  private runtimeReplayPayload(
    event:
      | RequestBatchedEvent
      | RequestCancelledEvent
      | RequestCancellationRequestedEvent
      | RequestFailedEvent
      | RequestStartedEvent
      | RequestSubmittedEvent
  ): Record<string, number | string> {
    switch (event.type) {
      case "request_submitted":
        return {
          maxTokens: event.maxTokens,
          prompt: event.prompt
        };
      case "request_batched":
        return {
          batchId: event.batchId,
          batchSize: event.batchSize
        };
      case "request_started":
        return {
          batchId: event.batchId,
          batchSize: event.batchSize,
          queueTimeMs: event.queueTimeMs
        };
      case "request_cancellation_requested":
      case "request_cancelled":
        return {
          stage: event.stage
        };
      case "request_failed":
        return {
          error: event.error
        };
    }
  }

  private toSnapshot(record: RequestRecord): InferenceRuntimeRequestSnapshot {
    return {
      cacheUsage: record.kvCache.getUsage(),
      cancellationRequested: record.cancellationRequested,
      eventCount: record.events.length,
      id: record.id,
      maxTokens: record.maxTokens,
      metrics: record.metrics.snapshot(),
      outputText: record.outputText,
      outputTokens: [...record.outputTokens],
      prompt: record.input.prompt,
      replayTraceId: record.replay.snapshot().traceId,
      status: record.status,
      submittedAtMs: record.submittedAtMs,
      ...(record.batchId !== undefined ? { batchId: record.batchId } : {}),
      ...(record.batchSize !== undefined ? { batchSize: record.batchSize } : {}),
      ...(record.completedAtMs !== undefined ? { completedAtMs: record.completedAtMs } : {}),
      ...(record.completion !== undefined ? { completion: record.completion } : {}),
      ...(record.error !== undefined ? { error: record.error } : {}),
      ...(record.finishReason !== undefined ? { finishReason: record.finishReason } : {}),
      ...(record.input.model !== undefined ? { model: record.input.model } : {}),
      ...(record.queueTimeMs !== undefined ? { queueTimeMs: record.queueTimeMs } : {}),
      ...(record.startedAtMs !== undefined ? { startedAtMs: record.startedAtMs } : {})
    };
  }

  private updateBatchHistory(batchId: string, requestId: string, queueTimeMs: number): void {
    const batch = this.batchHistory.find((entry) => entry.batchId === batchId);

    if (batch === undefined) {
      return;
    }

    batch.queueTimeMsByRequestId[requestId] = queueTimeMs;
    const queueTimes = Object.values(batch.queueTimeMsByRequestId);
    batch.averageQueueTimeMs = queueTimes.reduce((sum, value) => sum + value, 0) / queueTimes.length;
  }
}
