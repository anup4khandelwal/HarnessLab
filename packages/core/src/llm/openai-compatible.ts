import { asJsonObject, safeJsonStringify } from "../common";
import type { JsonObject, JsonValue } from "../common";
import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from "./types";

export interface OpenAICompatibleClientOptions {
  apiKey?: string;
  baseUrl?: string;
  chatPath?: string;
  defaultTemperature?: number;
  headers?: Record<string, string>;
  model: string;
}

export interface OpenAICompatibleEmbeddingModelOptions {
  apiKey?: string;
  baseUrl?: string;
  embeddingPath?: string;
  headers?: Record<string, string>;
  model: string;
}

interface OpenAICompatibleChoice {
  message?: {
    content?: JsonValue;
  };
}

interface OpenAICompatibleUsage {
  completion_tokens?: number;
  prompt_tokens?: number;
  total_tokens?: number;
}

export class OpenAICompatibleClient implements LlmClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly chatPath: string;
  private readonly defaultTemperature: number | undefined;
  private readonly headers: Record<string, string>;
  private readonly model: string;

  public constructor(options: OpenAICompatibleClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.chatPath = options.chatPath ?? "/chat/completions";
    this.defaultTemperature = options.defaultTemperature;
    this.headers = options.headers ?? {};
    this.model = options.model;
  }

  public get name(): string {
    return `openai-compatible:${this.model}`;
  }

  public async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const response = await fetch(buildUrl(this.baseUrl, this.chatPath), {
      body: JSON.stringify({
        max_tokens: request.maxTokens,
        messages: request.messages,
        model: this.model,
        response_format:
          request.responseFormat?.type === "json_object"
            ? {
                type: "json_object"
              }
            : undefined,
        temperature: request.temperature ?? this.defaultTemperature
      }),
      headers: this.buildHeaders(),
      method: "POST"
    });

    if (!response.ok) {
      throw new Error(`LLM request failed ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as JsonObject;
    const message = (((payload.choices ?? []) as JsonValue[])[0] ?? null) as JsonValue;
    const choice = asJsonObject(message) as OpenAICompatibleChoice;
    const content = extractTextContent(choice.message?.content);
    const usage = asJsonObject(payload.usage) as OpenAICompatibleUsage;

    const result: LlmCompletionResult = {
      content,
      model: typeof payload.model === "string" ? payload.model : this.model,
      raw: payload
    };

    const normalizedUsage = buildUsage(usage);

    if (normalizedUsage !== undefined) {
      result.usage = normalizedUsage;
    }

    return result;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.headers
    };

    if (this.apiKey !== undefined && headers.Authorization === undefined) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return headers;
  }
}

interface EmbeddingModel {
  dimensions: number | undefined;
  embed(texts: string[]): Promise<number[][]>;
  name: string;
}

export class OpenAICompatibleEmbeddingModel implements EmbeddingModel {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  public dimensions: number | undefined;
  private readonly embeddingPath: string;
  private readonly headers: Record<string, string>;
  private readonly model: string;

  public constructor(options: OpenAICompatibleEmbeddingModelOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.embeddingPath = options.embeddingPath ?? "/embeddings";
    this.headers = options.headers ?? {};
    this.model = options.model;
  }

  public get name(): string {
    return `openai-compatible-embedding:${this.model}`;
  }

  public async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(buildUrl(this.baseUrl, this.embeddingPath), {
      body: JSON.stringify({
        input: texts,
        model: this.model
      }),
      headers: this.buildHeaders(),
      method: "POST"
    });

    if (!response.ok) {
      throw new Error(`Embedding request failed ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as JsonObject;
    const data = Array.isArray(payload.data) ? payload.data : [];
    const vectors = data.map((item) => {
      const vector = asJsonObject(item).embedding;

      if (!Array.isArray(vector)) {
        throw new Error(`Embedding response was missing a vector: ${safeJsonStringify(payload)}`);
      }

      return vector.map((value) => {
        if (typeof value !== "number") {
          throw new Error(`Embedding values must be numeric: ${safeJsonStringify(payload)}`);
        }

        return value;
      });
    });

    this.dimensions = vectors[0]?.length ?? this.dimensions;
    return vectors;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.headers
    };

    if (this.apiKey !== undefined && headers.Authorization === undefined) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return headers;
  }
}

const buildUrl = (baseUrl: string, path: string): string => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${normalizedBase}${normalizedPath}`;
};

const extractTextContent = (content: JsonValue | undefined): string => {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        const candidate = asJsonObject(entry);
        return typeof candidate.text === "string" ? candidate.text : "";
      })
      .filter((entry) => entry.length > 0)
      .join("\n");
  }

  return "";
};

const buildUsage = (usage: OpenAICompatibleUsage): LlmCompletionResult["usage"] => {
  const result: NonNullable<LlmCompletionResult["usage"]> = {};

  if (typeof usage.prompt_tokens === "number") {
    result.inputTokens = usage.prompt_tokens;
  }

  if (typeof usage.completion_tokens === "number") {
    result.outputTokens = usage.completion_tokens;
  }

  if (typeof usage.total_tokens === "number") {
    result.totalTokens = usage.total_tokens;
  }

  return Object.keys(result).length === 0 ? undefined : result;
};
