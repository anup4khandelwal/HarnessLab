import { SafeMathModel, SchemaFailureModel, createDemoRuntime } from "@harnesslab/core";
import type { LearningModule } from "@harnesslab/core";

const FIX_TOOL_INPUT = false;

export const toolsModule: LearningModule = {
  description: "Shows JSON-schema based tool validation and safe execution.",
  failureMode: "The model passes the wrong input type into a registered tool, causing schema validation failure.",
  async run() {
    const runtime = createDemoRuntime(FIX_TOOL_INPUT ? new SafeMathModel() : new SchemaFailureModel());
    const result = await runtime.run({
      goal: "Use the calculator tool correctly."
    });

    return {
      detail: FIX_TOOL_INPUT
        ? "Tool contract fixed. The model conforms to the tool schema."
        : "Failure demo: the calculator tool rejects string input for `a`. Switch to SafeMathModel to fix it.",
      result: {
        output: result.output ?? null,
        reason: result.reason,
        status: result.status
      },
      status: FIX_TOOL_INPUT ? "success" : "failure_demo"
    };
  },
  slug: "03_tools",
  title: "03 Tools"
};

export default toolsModule;

