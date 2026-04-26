import type { JsonValue } from "../common";
import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from "./types";

export type StaticLlmResponder =
  | LlmCompletionResult
  | ((request: LlmCompletionRequest) => Promise<LlmCompletionResult> | LlmCompletionResult);

export class StaticLlmClient implements LlmClient {
  private readonly responder: StaticLlmResponder;
  public readonly name: string;

  public constructor(responder: StaticLlmResponder, name = "static-llm") {
    this.responder = responder;
    this.name = name;
  }

  public async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    if (typeof this.responder === "function") {
      return this.responder(request);
    }

    return this.responder;
  }
}

export const createJsonCompletion = (
  content: JsonValue,
  model = "static-llm",
  totalTokens = 32
): LlmCompletionResult => ({
  content: JSON.stringify(content),
  model,
  raw: content,
  usage: {
    totalTokens
  }
});

