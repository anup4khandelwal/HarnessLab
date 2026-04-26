import { BasicReflectiveModel, EvaluationEngine, SafeMathModel, createDemoRuntime } from "@harnesslab/core";
import type { EvalCase, LearningModule } from "@harnesslab/core";

const FIX_REGRESSION = false;

const cases: EvalCase[] = [
  {
    expectations: {
      expectedStatus: "completed",
      maxSteps: 3,
      outputIncludes: ["4"],
      requiredTools: ["math.add"]
    },
    input: {
      goal: "What is 2 + 2?"
    },
    name: "math-answer"
  },
  {
    expectations: {
      expectedStatus: "completed",
      minTraceEvents: 8,
      requiredTools: ["math.add"]
    },
    input: {
      goal: "Use a tool and then answer."
    },
    name: "tool-usage"
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
        failed: report.failed,
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
