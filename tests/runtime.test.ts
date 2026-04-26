import { describe, expect, test } from "bun:test";
import { AllowAllPolicy, BasicReflectiveModel, LoopingModel, SafeMathModel, createDemoRuntime } from "@harnesslab/core";

describe("AgentRuntime", () => {
  test("completes a safe math run", async () => {
    const runtime = createDemoRuntime(new SafeMathModel(), {
      policy: new AllowAllPolicy()
    });
    const result = await runtime.run({
      goal: "What is 2 + 2?"
    });

    expect(result.status).toBe("completed");
    expect(result.output).toContain("4");
  });

  test("escalates when a tool loop is detected", async () => {
    const runtime = createDemoRuntime(new LoopingModel());
    const result = await runtime.run({
      goal: "Loop until the detector stops you."
    });

    expect(result.status).toBe("escalated");
    expect(result.reason).toContain("Repeated tool signature");
  });

  test("stops a no-harness agent at the step limit", async () => {
    const runtime = createDemoRuntime(new BasicReflectiveModel(), {
      stepLimit: 3
    });
    const result = await runtime.run({
      goal: "Reflect forever."
    });

    expect(result.status).toBe("stopped");
    expect(result.reason).toContain("Step limit");
  });
});
