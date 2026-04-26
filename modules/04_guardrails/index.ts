import { RuleBasedPolicy, SafeMathModel, StaticApprovalGate, UnsafeModel, createDemoRuntime } from "@harnesslab/core";
import type { LearningModule } from "@harnesslab/core";

const APPROVE_UNSAFE_TOOL = false;

export const guardrailsModule: LearningModule = {
  description: "Exercises the guardrails layer by denying or approving sensitive tool calls.",
  failureMode: "An unsafe tool call is blocked by policy before execution.",
  async run() {
    const policy = APPROVE_UNSAFE_TOOL
      ? new RuleBasedPolicy(
          [
            {
              effect: "require_approval",
              reason: "unsafe.shell requires explicit approval",
              tool: "unsafe.shell"
            }
          ],
          new StaticApprovalGate(true)
        )
      : new RuleBasedPolicy([
          {
            effect: "deny",
            reason: "unsafe.shell is blocked in this lesson",
            tool: "unsafe.shell"
          }
        ]);

    const runtime = createDemoRuntime(APPROVE_UNSAFE_TOOL ? new SafeMathModel() : new UnsafeModel(), {
      policy
    });
    const result = await runtime.run({
      goal: "Attempt an unsafe action."
    });

    return {
      detail: APPROVE_UNSAFE_TOOL
        ? "Guardrails adjusted. The lesson now uses a safe model path."
        : "Failure demo: policy blocks unsafe.shell before execution. Replace the model or add a gated approval path to fix it.",
      result: {
        output: result.output ?? null,
        reason: result.reason,
        status: result.status
      },
      status: APPROVE_UNSAFE_TOOL ? "success" : "failure_demo"
    };
  },
  slug: "04_guardrails",
  title: "04 Guardrails"
};

export default guardrailsModule;
