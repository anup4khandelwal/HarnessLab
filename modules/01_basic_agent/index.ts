import { BasicReflectiveModel, SafeMathModel, createDemoRuntime } from "@harnesslab/core";
import type { LearningModule } from "@harnesslab/core";

const ENABLE_HARNESS = false;

export const basicAgentModule: LearningModule = {
  description: "A naive agent with no harness loop discipline. It reflects forever until a limit stops it.",
  failureMode: "The agent never produces a final answer because nothing verifies progress or completion.",
  async run() {
    const runtime = ENABLE_HARNESS
      ? createDemoRuntime(new SafeMathModel(), {
          stepLimit: 4
        })
      : createDemoRuntime(new BasicReflectiveModel(), {
          stepLimit: 4
        });

    const result = await runtime.run({
      goal: "Figure out 2 + 2 and answer clearly."
    });

    return {
      detail: ENABLE_HARNESS
        ? "Harness enabled. The runtime now terminates with a usable answer."
        : "Failure demo: the basic agent keeps reflecting until the step limit stops it. Flip ENABLE_HARNESS to true to fix the module.",
      result: {
        output: result.output ?? null,
        reason: result.reason,
        status: result.status
      },
      status: ENABLE_HARNESS ? "success" : "failure_demo"
    };
  },
  slug: "01_basic_agent",
  title: "01 Basic Agent"
};

export default basicAgentModule;

