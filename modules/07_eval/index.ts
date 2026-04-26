import { BasicReflectiveModel, EvaluationEngine, SafeMathModel, createDemoRuntime } from "@harnesslab/core";
import type { EvalCase, LearningModule } from "@harnesslab/core";

const FIX_REGRESSION = false;

const cases: EvalCase[] = [
  {
    input: {
      goal: "What is 2 + 2?"
    },
    name: "math-answer",
    scorer: ({ output, status }) => (status === "completed" && output?.includes("4") ? 1 : 0)
  },
  {
    input: {
      goal: "Use a tool and then answer."
    },
    name: "tool-usage",
    scorer: ({ output, status }) => (status === "completed" && (output?.length ?? 0) > 0 ? 1 : 0)
  }
];

export const evalModule: LearningModule = {
  description: "Runs the agent against repeatable test cases so harness changes can be regression tested.",
  failureMode: "A weak agent fails the suite and exposes a measurable regression.",
  async run() {
    const engine = new EvaluationEngine(() =>
      createDemoRuntime(FIX_REGRESSION ? new SafeMathModel() : new BasicReflectiveModel(), {
        stepLimit: 4
      })
    );
    const report = await engine.run(cases);

    return {
      detail: FIX_REGRESSION
        ? "Evaluation passed. The harness now clears the regression suite."
        : "Failure demo: the naive model fails the evaluation suite. Switch to SafeMathModel to fix it.",
      result: {
        averageScore: report.averageScore,
        passed: report.passed,
        total: report.total
      },
      status: FIX_REGRESSION ? "success" : "failure_demo"
    };
  },
  slug: "07_eval",
  title: "07 Eval"
};

export { cases as evalCases };
export default evalModule;

