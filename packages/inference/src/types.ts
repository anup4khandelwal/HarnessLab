import type { RequestMetricsTracker, RequestMetricsSnapshot, PricingModel } from "@harnesslab/metrics";
import type { KvCacheSimulator, KvCacheUsage } from "@harnesslab/memory";
import type { ReplayRecorder } from "@harnesslab/replay";

export type InferenceFinishReason = "exhausted_plan" | "max_tokens" | "stop_token";

export interface InferenceRequest {
  decodeLatencyMs?: number;
  generationPlan?: string[];
  id: string;
  kvCache?: KvCacheSimulator;
  maxTokens: number;
  metrics?: RequestMetricsTracker;
  model?: string;
  prefillLatencyMs?: number;
  pricing?: Partial<PricingModel>;
  prompt: string;
  replayRecorder?: ReplayRecorder;
  stopTokens?: string[];
}

export interface ResolvedInferenceRequest {
  decodeLatencyMs: number;
  generationPlan: string[];
  id: string;
  kvCache: KvCacheSimulator;
  maxTokens: number;
  metrics: RequestMetricsTracker;
  model: string;
  prefillLatencyMs: number;
  pricing: Partial<PricingModel>;
  prompt: string;
  replayRecorder: ReplayRecorder | undefined;
  stopTokens: string[];
}

export interface PrefillState {
  done: boolean;
  finishReason: InferenceFinishReason | undefined;
  metrics: RequestMetricsTracker;
  outputTokens: string[];
  prefillCompletedAtMs: number;
  promptTokens: string[];
  remainingPlan: string[];
  replayRecorder: ReplayRecorder | undefined;
  request: ResolvedInferenceRequest;
}

export interface PrefillEvent {
  cacheUsage: KvCacheUsage;
  latencyMs: number;
  metrics: RequestMetricsSnapshot;
  phase: "prefill";
  promptTokens: string[];
  requestId: string;
  type: "prefill";
}

export interface TokenEvent {
  cacheUsage: KvCacheUsage;
  latencyMs: number;
  metrics: RequestMetricsSnapshot;
  outputText: string;
  phase: "decode";
  requestId: string;
  token: string;
  tokenIndex: number;
  type: "token";
}

export interface CompletionEvent {
  cacheUsage: KvCacheUsage;
  finishReason: InferenceFinishReason;
  metrics: RequestMetricsSnapshot;
  outputText: string;
  outputTokens: string[];
  phase: "decode";
  requestId: string;
  type: "completed";
}

export type InferenceEvent = CompletionEvent | PrefillEvent | TokenEvent;

export interface DecodeResult {
  event: TokenEvent | undefined;
  finishReason: InferenceFinishReason | undefined;
}

export interface InferenceRunResult {
  completion: CompletionEvent;
  events: InferenceEvent[];
}

