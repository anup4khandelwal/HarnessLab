import {
  EvaluationEngine,
  SafeMathModel,
  StaticLlmClient,
  createDemoRuntime,
  createJsonCompletion,
  createLlmJudge
} from "@harnesslab/core";
import type {
  AgentModel,
  AgentPlan,
  EvalCase,
  LearningModule,
  LlmJudgeVerdict
} from "@harnesslab/core";

// Flip to true to replace rule-based string-matching with an LLM-as-judge
// scorer that evaluates semantic quality.
const ENABLE_LLM_JUDGE = false;

// A model that produces a vague answer containing "4" — it bypasses
// outputIncludes checks but does not actually demonstrate tool use or
// a confident, well-reasoned response.
class VagueModel implements AgentModel {
  public readonly name = "vague-model";

  public async plan(): Promise<AgentPlan> {
    return {
      action: {
        done: true,
        kind: "respond",
        output: "Hmm, the answer could probably be around 4 or so, I think."
      },
      summary: "Vague guess — skips tool use entirely."
    };
  }
}

// Deterministic judge client: inspects the user prompt to decide the score.
// A real deployment would use an OpenAI-compatible model here.
const judgeClient = new StaticLlmClient((request) => {
  const userContent = request.messages.find((m) => m.role === "user")?.content ?? "";
  const isGoodOutput = userContent.includes("The answer is");

  return createJsonCompletion(
    isGoodOutput
      ? { reasoning: "Clear answer derived from the math.add tool result.", score: 9 }
      : { reasoning: "Vague guess — no tool was used and the response lacks confidence.", score: 2 }
  );
});

const buildCases = (
  goodVerdicts: LlmJudgeVerdict[],
  vagueVerdicts: LlmJudgeVerdict[]
): { goodCase: EvalCase; vagueCase: EvalCase } => {
  if (ENABLE_LLM_JUDGE) {
    return {
      goodCase: {
        input: { goal: "What is 2 + 2?" },
        name: "good-agent",
        scorer: createLlmJudge({ client: judgeClient, onVerdict: (v) => goodVerdicts.push(v) })
      },
      vagueCase: {
        input: { goal: "What is 2 + 2?" },
        name: "vague-agent",
        scorer: createLlmJudge({ client: judgeClient, onVerdict: (v) => vagueVerdicts.push(v) })
      }
    };
  }

  // Rule-based: outputIncludes passes any output containing "4",
  // including the vague model's guess — a false positive.
  const ruleCase = (name: string): EvalCase => ({
    expectations: { outputIncludes: ["4"] },
    input: { goal: "What is 2 + 2?" },
    name
  });

  return {
    goodCase: ruleCase("good-agent"),
    vagueCase: ruleCase("vague-agent")
  };
};

export const llmJudgeModule: LearningModule = {
  description:
    "Demonstrates why LLM-as-judge eval catches quality issues that rule-based string matching misses.",
  failureMode:
    'outputIncludes:["4"] passes for both a good answer and a vague guess — the rule cannot distinguish quality.',
  async run() {
    const goodVerdicts: LlmJudgeVerdict[] = [];
    const vagueVerdicts: LlmJudgeVerdict[] = [];
    const { goodCase, vagueCase } = buildCases(goodVerdicts, vagueVerdicts);

    const goodReport = await new EvaluationEngine(() =>
      createDemoRuntime(new SafeMathModel())
    ).run([goodCase]);

    const vagueReport = await new EvaluationEngine(() =>
      createDemoRuntime(new VagueModel())
    ).run([vagueCase]);

    const goodResult = goodReport.cases[0];
    const vagueResult = vagueReport.cases[0];

    const summary = ENABLE_LLM_JUDGE
      ? `LLM judge enabled. Good agent scored ${goodResult?.score.toFixed(1)} (passed: ${String(goodResult?.passed)}), vague agent scored ${vagueResult?.score.toFixed(1)} (passed: ${String(vagueResult?.passed)}).`
      : `Failure demo: rule-based eval passes both agents (good: ${String(goodResult?.passed)}, vague: ${String(vagueResult?.passed)}) — string matching cannot distinguish quality. Flip ENABLE_LLM_JUDGE to true to fix this.`;

    return {
      detail: summary,
      result: {
        goodAgent: {
          output: goodResult?.output ?? null,
          passed: goodResult?.passed ?? false,
          score: goodResult?.score ?? 0,
          ...(ENABLE_LLM_JUDGE && goodVerdicts[0] !== undefined
            ? { judgeRawScore: goodVerdicts[0].rawScore, judgeReasoning: goodVerdicts[0].reasoning }
            : {})
        },
        vagueAgent: {
          output: vagueResult?.output ?? null,
          passed: vagueResult?.passed ?? false,
          score: vagueResult?.score ?? 0,
          ...(ENABLE_LLM_JUDGE && vagueVerdicts[0] !== undefined
            ? { judgeRawScore: vagueVerdicts[0].rawScore, judgeReasoning: vagueVerdicts[0].reasoning }
            : {})
        }
      },
      status: ENABLE_LLM_JUDGE ? "success" : "failure_demo"
    };
  },
  slug: "10_llm_judge",
  title: "10 LLM Judge"
};

export default llmJudgeModule;
