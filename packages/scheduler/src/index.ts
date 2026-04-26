export interface BatchDescriptor<TRequest> {
  batchId: string;
  enqueuedAtMs: number[];
  requests: TRequest[];
}

export interface ScheduledResult<TResult> {
  batchId: string;
  queueTimeMs: number;
  result: TResult;
}

export interface ProcessedBatch<TResult> {
  batchId: string;
  size: number;
  totalQueueTimeMs: number;
  results: ScheduledResult<TResult>[];
}

export type BatchHandler<TRequest, TResult> = (
  batch: BatchDescriptor<TRequest>
) => Promise<TResult[]> | TResult[];

export interface SchedulerOptions<TRequest, TResult> {
  batchingWindowMs?: number;
  maxBatchSize?: number;
  processBatch: BatchHandler<TRequest, TResult>;
}

interface QueueEntry<TRequest, TResult> {
  enqueuedAtMs: number;
  reject(error: Error): void;
  request: TRequest;
  resolve(value: ScheduledResult<TResult>): void;
}

export class RequestScheduler<TRequest, TResult> {
  private readonly batchingWindowMs: number;
  private batchCounter = 0;
  private readonly maxBatchSize: number;
  private readonly processBatchHandler: BatchHandler<TRequest, TResult>;
  private readonly queue: QueueEntry<TRequest, TResult>[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(options: SchedulerOptions<TRequest, TResult>) {
    this.batchingWindowMs = options.batchingWindowMs ?? 10;
    this.maxBatchSize = options.maxBatchSize ?? 8;
    this.processBatchHandler = options.processBatch;
  }

  public enqueue(request: TRequest): Promise<ScheduledResult<TResult>> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        enqueuedAtMs: performance.now(),
        reject,
        request,
        resolve
      });
      this.schedule();
    });
  }

  public async processBatch(): Promise<ProcessedBatch<TResult> | null> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.queue.length === 0) {
      return null;
    }

    const entries = this.queue.splice(0, this.maxBatchSize);
    const batchId = `batch_${(++this.batchCounter).toString(36)}`;
    const descriptor: BatchDescriptor<TRequest> = {
      batchId,
      enqueuedAtMs: entries.map((entry) => entry.enqueuedAtMs),
      requests: entries.map((entry) => entry.request)
    };

    try {
      const results = await this.processBatchHandler(descriptor);

      if (results.length !== entries.length) {
        throw new Error(`Batch handler returned ${results.length} results for ${entries.length} requests`);
      }

      const scheduled = entries.map((entry, index) => {
        const value: ScheduledResult<TResult> = {
          batchId,
          queueTimeMs: performance.now() - entry.enqueuedAtMs,
          result: results[index]!
        };
        entry.resolve(value);
        return value;
      });

      return {
        batchId,
        results: scheduled,
        size: entries.length,
        totalQueueTimeMs: scheduled.reduce((sum, entry) => sum + entry.queueTimeMs, 0)
      };
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));

      for (const entry of entries) {
        entry.reject(error);
      }

      throw error;
    } finally {
      if (this.queue.length > 0) {
        this.schedule();
      }
    }
  }

  public pendingCount(): number {
    return this.queue.length;
  }

  public cancel(match: (request: TRequest) => boolean, error = new Error("Scheduled request was cancelled")): number {
    const retained = this.queue.filter((entry) => !match(entry.request));
    const removed = this.queue.filter((entry) => match(entry.request));

    if (removed.length === 0) {
      return 0;
    }

    this.queue.splice(0, this.queue.length, ...retained);

    for (const entry of removed) {
      entry.reject(error);
    }

    if (this.queue.length === 0 && this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    return removed.length;
  }

  private schedule(): void {
    if (this.timer !== undefined) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.processBatch();
    }, this.batchingWindowMs);
  }
}
