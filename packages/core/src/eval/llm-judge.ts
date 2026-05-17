import { asJsonObject, safeJsonStringify } from "../common";
import type { JsonValue } from "../common";
import type { LlmClient } from "../llm/types";
import type { EvalScorer, EvalScorerContext } from "./evaluator";

export interface LlmJudgeOptions {
  client: LlmClient;
  maxTokens?: number;
  onVerdict?: (verdict: LlmJudgeVerdict, context: EvalScorerContext) => void;
  rubric?: string;
  temperature?: number;
}

export interface LlmJudgeVerdict {
  normalizedScore: number;
  rawScore: number;
  reasoning: string;
}

const DEFAULT_RUBRIC =
  "Score the agent run from 0 to 10. Consider: (1) whether the goal was achieved, " +
  "(2) whether the output is accurate and complete, (3) whether tools were used appropriately. " +
  'Return only JSON with shape: {"score": <integer 0-10>, "reasoning": "<one concise sentence>"}';

export const createLlmJudge = (options: LlmJudgeOptions): EvalScorer => {
  return async (context: EvalScorerContext): Promise<number> => {
    try {
      const request = {
        maxTokens: options.maxTokens ?? 256,
        messages: [
          {
            content: options.rubric ?? DEFAULT_RUBRIC,
            role: "system" as const
          },
          {
            content: buildJudgePrompt(context),
            role: "user" as const
          }
        ],
        responseFormat: { type: "json_object" as const }
      };

      const completion = await options.client.complete(
        options.temperature !== undefined
          ? { ...request, temperature: options.temperature }
          : request
      );

      const verdict = parseVerdict(completion.content);
      options.onVerdict?.(verdict, context);
      return verdict.normalizedScore;
    } catch {
      const verdict: LlmJudgeVerdict = {
        normalizedScore: 0,
        rawScore: 0,
        reasoning: "Judge LLM call failed."
      };
      options.onVerdict?.(verdict, context);
      return 0;
    }
  };
};

const buildJudgePrompt = (context: EvalScorerContext): string =>
  [
    `Goal: ${context.input.goal}`,
    `Status: ${context.status}`,
    `Steps: ${context.metrics.steps}`,
    `Tools called: ${context.toolCalls.length > 0 ? context.toolCalls.join(", ") : "none"}`,
    `Output: ${context.output ?? "(no output)"}`
  ].join("\n");

const parseVerdict = (content: string): LlmJudgeVerdict => {
  try {
    const cleaned = content.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
    const parsed = JSON.parse(cleaned) as JsonValue;
    const obj = asJsonObject(parsed);
    const rawScoreValue = obj.score;
    const reasoningValue = obj.reasoning;

    const rawScore =
      typeof rawScoreValue === "number"
        ? rawScoreValue
        : typeof rawScoreValue === "string"
          ? Number(rawScoreValue)
          : NaN;

    if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > 10) {
      return fallbackVerdict(
        `Judge returned an invalid score: ${safeJsonStringify(rawScoreValue ?? null)}`
      );
    }

    return {
      normalizedScore: rawScore / 10,
      rawScore,
      reasoning: typeof reasoningValue === "string" ? reasoningValue : safeJsonStringify(obj)
    };
  } catch {
    return fallbackVerdict("Judge response could not be parsed as JSON.");
  }
};

const fallbackVerdict = (reasoning: string): LlmJudgeVerdict => ({
  normalizedScore: 0,
  rawScore: 0,
  reasoning
});
