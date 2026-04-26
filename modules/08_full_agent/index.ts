import { createFullAgentHarness } from "@harnesslab/core";
import type { LearningModule } from "@harnesslab/core";

export const fullAgentModule: LearningModule = {
  description: "A production-style educational harness that combines tools, policy, memory, tracing, hooks, and evaluation-friendly behavior.",
  failureMode: "This module is the fixed reference implementation.",
  async run() {
    return createFullAgentHarness().run({
      goal: "Use the harness runtime to answer: what is 2 + 2?"
    });
  },
  slug: "08_full_agent",
  title: "08 Full Agent"
};

export default fullAgentModule;

