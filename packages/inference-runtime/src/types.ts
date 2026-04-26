import type { CompletionEvent, InferenceEvent, InferenceFinishReason } from "@harnesslab/inference";
import type { KvCacheOptions, KvCacheSimulator, KvCacheUsage } from "@harnesslab/memory";
import type { PricingModel, RequestMetricsSnapshot, RequestMetricsTracker } from "@harnesslab/metrics";
import type { ReplayRecorder, ReplayTrace } from "@harnesslab/replay";

export type InferenceRuntimeStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type InferenceRuntimeFinishReason = InferenceFinishReason | "cancelled" | "failed";

export interface InferenceRuntimeOptions {
  batchingWindowMs?: number;
  defaultKvCacheOptions?: Partial<KvCacheOptions>;
  defaultMaxTokens?: number;
  maxBatchSize?: number;
  requestIdPrefix?: string;
}

export interface InferenceRuntimeRequestInput {
  decodeLatencyMs?: number;
  generationPlan?: string[];
  id?: string;
  kvCache?: KvCacheSimulator;
  kvCacheOptions?: Partial<KvCacheOptions>;
  maxTokens?: number;
  metrics?: RequestMetricsTracker;
  model?: string;
  prefillLatencyMs?: number;
  pricing?: Partial<PricingModel>;
  prompt: string;
  replayRecorder?: ReplayRecorder;
  stopTokens?: string[];
}

export interface InferenceRuntimeBatchSnapshot {
  averageQueueTimeMs?: number;
  batchId: string;
  launchedAtMs: number;
  queueTimeMsByRequestId: Record<string, number>;
  requestIds: string[];
  size: number;
}

interface RuntimeEventBase {
  requestId: string;
  timestampMs: number;
}

export interface RequestSubmittedEvent extends RuntimeEventBase {
  maxTokens: number;
  prompt: string;
  type: "request_submitted";
}

export interface RequestBatchedEvent extends RuntimeEventBase {
  batchId: string;
  batchSize: number;
  type: "request_batched";
}

export interface RequestStartedEvent extends RuntimeEventBase {
  batchId: string;
  batchSize: number;
  queueTimeMs: number;
  type: "request_started";
}

export interface RequestCancellationRequestedEvent extends RuntimeEventBase {
  stage: "queued" | "running";
  type: "request_cancellation_requested";
}

export interface RequestCancelledEvent extends RuntimeEventBase {
  stage: "queued" | "running";
  type: "request_cancelled";
}

export interface RequestFailedEvent extends RuntimeEventBase {
  error: string;
  type: "request_failed";
}

export type InferenceRuntimeEvent =
  | InferenceEvent
  | RequestBatchedEvent
  | RequestCancellationRequestedEvent
  | RequestCancelledEvent
  | RequestFailedEvent
  | RequestStartedEvent
  | RequestSubmittedEvent;

export interface InferenceRuntimeRequestSnapshot {
  batchId?: string;
  batchSize?: number;
  cacheUsage: KvCacheUsage;
  cancellationRequested: boolean;
  completedAtMs?: number;
  completion?: CompletionEvent;
  error?: string;
  eventCount: number;
  finishReason?: InferenceRuntimeFinishReason;
  id: string;
  maxTokens: number;
  metrics: RequestMetricsSnapshot;
  model?: string;
  outputText: string;
  outputTokens: string[];
  prompt: string;
  queueTimeMs?: number;
  replayTraceId: string;
  startedAtMs?: number;
  status: InferenceRuntimeStatus;
  submittedAtMs: number;
}

export interface InferenceRuntimeReplaySnapshot {
  request: InferenceRuntimeRequestSnapshot;
  trace: ReplayTrace;
}
