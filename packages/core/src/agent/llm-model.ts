import { asJsonObject, safeJsonStringify } from "../common";
import type { JsonObject, JsonValue } from "../common";
import type { ToolRegistry } from "../tooling/tool-registry";
import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from "../llm/types";
import type {
  AgentAction,
  AgentModel,
  AgentPlan,
  AgentPlanningResult,
  Observation,
  RuntimeState
} from "./runtime";

export interface JsonPlanAgentModelOptions {
  client: LlmClient;
  maxTokens?: number;
  systemPrompt?: string;
  temperature?: number;
  tools: ToolRegistry;
}

export class JsonPlanAgentModel implements AgentModel {
  private readonly client: LlmClient;
  private readonly maxTokens: number | undefined;
  public readonly name: string;
  private readonly systemPrompt: string;
  private readonly temperature: number | undefined;
  private readonly tools: ToolRegistry;

  public constructor(options: JsonPlanAgentModelOptions) {
    this.client = options.client;
    this.maxTokens = options.maxTokens;
    this.name = `json-plan:${options.client.name}`;
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.temperature = options.temperature;
    this.tools = options.tools;
  }

  public estimateTokens(observation: Observation): number {
    return Math.ceil(this.buildUserPrompt(observation, {}).length / 4);
  }

  public async plan(observation: Observation, state: RuntimeState): Promise<AgentPlanningResult> {
    const request: LlmCompletionRequest = {
      messages: [
        {
          content: this.systemPrompt,
          role: "system"
        },
        {
          content: this.buildUserPrompt(observation, state.workingMemory),
          role: "user"
        }
      ],
      responseFormat: {
        type: "json_object"
      }
    };

    if (this.maxTokens !== undefined) {
      request.maxTokens = this.maxTokens;
    }

    if (this.temperature !== undefined) {
      request.temperature = this.temperature;
    }

    const completion = await this.client.complete(request);
    const plan = parseAgentPlan(completion);
    const result: AgentPlanningResult = {
      plan
    };

    if (completion.raw !== undefined) {
      result.raw = completion.raw;
    }

    if (completion.usage !== undefined) {
      result.usage = completion.usage;
    }

    return result;
  }

  private buildUserPrompt(observation: Observation, workingMemory: JsonObject): string {
    return [
      "Goal:",
      observation.input.goal,
      "",
      "Available tools:",
      JSON.stringify(this.tools.catalog()),
      "",
      "Memories:",
      safeJsonStringify(observation.memories),
      "",
      "Recent events:",
      safeJsonStringify(
        observation.recentEvents.map((event) => ({
          payload: event.payload,
          step: event.step,
          type: event.type
        }))
      ),
      "",
      "Working memory:",
      safeJsonStringify(workingMemory),
      "",
      "Remaining budget:",
      safeJsonStringify({
        remainingSteps: observation.remainingSteps,
        tokensRemaining: observation.tokensRemaining
      }),
      "",
      "Return only JSON with shape:",
      '{"summary":"...", "action":{"kind":"respond|reflect|tool","done":true,"output":"...","note":"...","tool":"...","input":{}}}'
    ].join("\n");
  }
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are the planning layer for an agent harness.",
  "Choose exactly one next action.",
  "Use kind=tool when external action is needed.",
  "Use kind=reflect only for short internal reasoning steps.",
  "Use kind=respond with done=true only when the task is complete.",
  "When using a tool, pick a tool name from the provided catalog and produce a valid JSON object for its input."
].join(" ");

const parseAgentPlan = (completion: LlmCompletionResult): AgentPlan => {
  const parsed = parseJsonObject(completion.content);
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim().length > 0
      ? parsed.summary
      : "LLM-generated plan";
  const action = parseAction(asJsonObject(parsed.action));

  return {
    action,
    summary
  };
};

const parseAction = (value: JsonObject): AgentAction => {
  const kind = typeof value.kind === "string" ? value.kind : undefined;

  if (kind === "respond") {
    const output = typeof value.output === "string" ? value.output : "";
    return {
      done: value.done === true,
      kind,
      output
    };
  }

  if (kind === "reflect") {
    return {
      kind,
      note: typeof value.note === "string" ? value.note : ""
    };
  }

  if (kind === "tool") {
    return {
      input: asJsonObject(value.input),
      kind,
      tool: typeof value.tool === "string" ? value.tool : ""
    };
  }

  throw new Error(`LLM returned an invalid action kind: ${safeJsonStringify(value as JsonValue)}`);
};

const parseJsonObject = (content: string): JsonObject => {
  const raw = content.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  const parsed = JSON.parse(raw) as JsonValue;
  const object = asJsonObject(parsed);

  if (Object.keys(object).length === 0 && parsed !== null && typeof parsed !== "object") {
    throw new Error(`LLM response was not a JSON object: ${content}`);
  }

  return object;
};
