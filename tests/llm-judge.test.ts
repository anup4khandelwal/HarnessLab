import { describe, expect, test } from "bun:test";
import {
  EvaluationEngine,
  SafeMathModel,
  StaticLlmClient,
  createDemoRuntime,
  createJsonCompletion,
  createLlmJudge
} from "@harnesslab/core";
import type { EvalScorerContext, LlmJudgeVerdict } from "@harnesslab/core";

const makeContext = (output: string | undefined, toolCalls: string[] = []): EvalScorerContext => ({
  events: [],
  input: { goal: "Test goal" },
  metrics: { steps: 2, tokenUsage: 64, toolCalls, traceEvents: 4 },
  output,
  reason: "completed",
  status: "completed",
  toolCalls
});

describe("createLlmJudge", () => {
  test("returns an EvalScorer function", () => {
    const scorer = createLlmJudge({
      client: new StaticLlmClient(createJsonCompletion({ score: 8, reasoning: "Good." }))
    });

    expect(typeof scorer).toBe("function");
  });

  test("normalizes a high raw score (9) to 0.9", async () => {
    const scorer = createLlmJudge({
      client: new StaticLlmClient(createJsonCompletion({ reasoning: "Excellent answer.", score: 9 }))
    });

    const result = await scorer(makeContext("The answer is 4."));
    expect(result).toBeCloseTo(0.9, 5);
  });

  test("normalizes a low raw score (2) to 0.2", async () => {
    const scorer = createLlmJudge({
      client: new StaticLlmClient(createJsonCompletion({ reasoning: "Vague and tool-free.", score: 2 }))
    });

    const result = await scorer(makeContext("Maybe 4 or so."));
    expect(result).toBeCloseTo(0.2, 5);
  });

  test("returns 0 for malformed JSON from the judge", async () => {
    const scorer = createLlmJudge({
      client: new StaticLlmClient({ content: "not valid json at all", model: "static" })
    });

    const result = await scorer(makeContext("some output"));
    expect(result).toBe(0);
  });

  test("returns 0 for an out-of-range score (> 10)", async () => {
    const scorer = createLlmJudge({
      client: new StaticLlmClient(createJsonCompletion({ reasoning: "Off scale.", score: 42 }))
    });

    const result = await scorer(makeContext("some output"));
    expect(result).toBe(0);
  });

  test("returns 0 for a missing score field", async () => {
    const scorer = createLlmJudge({
      client: new StaticLlmClient(createJsonCompletion({ reasoning: "No score here." }))
    });

    const result = await scorer(makeContext("some output"));
    expect(result).toBe(0);
  });

  test("returns 0 when the LLM client throws", async () => {
    const scorer = createLlmJudge({
      client: {
        complete: async () => {
          throw new Error("network error");
        },
        name: "failing-client"
      }
    });

    const result = await scorer(makeContext("output"));
    expect(result).toBe(0);
  });

  test("calls onVerdict with the parsed verdict", async () => {
    const verdicts: LlmJudgeVerdict[] = [];
    const scorer = createLlmJudge({
      client: new StaticLlmClient(
        createJsonCompletion({ reasoning: "Clear and correct.", score: 8 })
      ),
      onVerdict: (v) => verdicts.push(v)
    });

    await scorer(makeContext("The answer is 4."));

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.rawScore).toBe(8);
    expect(verdicts[0]?.normalizedScore).toBeCloseTo(0.8, 5);
    expect(verdicts[0]?.reasoning).toBe("Clear and correct.");
  });

  test("calls onVerdict with fallback verdict on parse failure", async () => {
    const verdicts: LlmJudgeVerdict[] = [];
    const scorer = createLlmJudge({
      client: new StaticLlmClient({ content: "broken", model: "static" }),
      onVerdict: (v) => verdicts.push(v)
    });

    await scorer(makeContext("output"));

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.rawScore).toBe(0);
    expect(verdicts[0]?.reasoning).toContain("parsed");
  });

  test("accepts a string score and normalizes it", async () => {
    const scorer = createLlmJudge({
      client: new StaticLlmClient(
        createJsonCompletion({ reasoning: "Acceptable.", score: "7" })
      )
    });

    const result = await scorer(makeContext("ok answer"));
    expect(result).toBeCloseTo(0.7, 5);
  });
});

describe("LLM judge in EvaluationEngine", () => {
  test("good agent passes and vague agent fails with a judge scorer", async () => {
    const goodVerdicts: LlmJudgeVerdict[] = [];
    const vagueVerdicts: LlmJudgeVerdict[] = [];

    const makeJudge = (bucket: LlmJudgeVerdict[]) =>
      createLlmJudge({
        client: new StaticLlmClient((request) => {
          const userMsg = request.messages.find((m) => m.role === "user")?.content ?? "";
          const isGood = userMsg.includes("The answer is");
          return createJsonCompletion(
            isGood
              ? { reasoning: "Correct tool-backed answer.", score: 9 }
              : { reasoning: "Vague, no tool used.", score: 2 }
          );
        }),
        onVerdict: (v) => bucket.push(v)
      });

    const goodReport = await new EvaluationEngine(() =>
      createDemoRuntime(new SafeMathModel())
    ).run([{ input: { goal: "What is 2 + 2?" }, name: "good", scorer: makeJudge(goodVerdicts) }]);

    // VagueModel inline — gives an answer containing "4" but skips tools
    const vagueReport = await new EvaluationEngine(() =>
      createDemoRuntime({
        name: "vague-inline",
        plan: async () => ({
          action: { done: true, kind: "respond", output: "Hmm, probably around 4 or so." },
          summary: "Vague"
        })
      })
    ).run([
      { input: { goal: "What is 2 + 2?" }, name: "vague", scorer: makeJudge(vagueVerdicts) }
    ]);

    expect(goodReport.cases[0]?.passed).toBe(true);
    expect(vagueReport.cases[0]?.passed).toBe(false);
    expect(goodVerdicts[0]?.rawScore).toBe(9);
    expect(vagueVerdicts[0]?.rawScore).toBe(2);
  });

  test("rule-based eval gives a false positive for a vague answer containing the expected string", async () => {
    const vagueReport = await new EvaluationEngine(() =>
      createDemoRuntime({
        name: "vague-inline",
        plan: async () => ({
          action: { done: true, kind: "respond", output: "The answer is probably 4 maybe." },
          summary: "Vague"
        })
      })
    ).run([
      {
        expectations: { outputIncludes: ["4"] },
        input: { goal: "What is 2 + 2?" },
        name: "vague-rule"
      }
    ]);

    // Rule passes because the string "4" is present — false positive
    expect(vagueReport.cases[0]?.passed).toBe(true);
  });
});
