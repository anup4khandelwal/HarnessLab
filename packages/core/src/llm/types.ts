import type { JsonValue } from "../common";

export type LlmMessageRole = "assistant" | "system" | "user";

export interface LlmMessage {
  content: string;
  role: LlmMessageRole;
}

export interface LlmResponseFormat {
  type: "json_object" | "text";
}

export interface LlmCompletionRequest {
  maxTokens?: number;
  messages: LlmMessage[];
  responseFormat?: LlmResponseFormat;
  temperature?: number;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface LlmCompletionResult {
  content: string;
  model: string;
  raw?: JsonValue;
  usage?: LlmUsage;
}

export interface LlmClient {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
  name: string;
}

