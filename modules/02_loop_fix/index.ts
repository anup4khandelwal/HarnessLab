import { LoopingModel, SafeMathModel, createDemoRuntime } from "@harnesslab/core";
import type { LearningModule } from "@harnesslab/core";

const FIX_LOOP = false;

export const loopFixModule: LearningModule = {
  description: "Demonstrates why repeated tool calls need explicit loop detection.",
  failureMode: "The model calls the same tool with the same input over and over until the loop detector escalates.",
  async run() {
    const runtime = createDemoRuntime(FIX_LOOP ? new SafeMathModel() : new LoopingModel(), {
      stepLimit: 6
    });
    const result = await runtime.run({
      goal: "Use tools to answer 2 + 2."
    });

    return {
      detail: FIX_LOOP
        ? "Loop fixed. The agent uses the tool once and then responds."
        : "Failure demo: repeated tool signatures trigger loop escalation. Swap to SafeMathModel to fix it.",
      result: {
        output: result.output ?? null,
        reason: result.reason,
        status: result.status
      },
      status: FIX_LOOP ? "success" : "failure_demo"
    };
  },
  slug: "02_loop_fix",
  title: "02 Loop Fix"
};

export default loopFixModule;

