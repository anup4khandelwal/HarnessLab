import { describe, expect, test } from "bun:test";
import {
  BasicReflectiveModel,
  EvaluationEngine,
  HashedEmbeddingModel,
  HybridMemory,
  InMemoryApprovalGate,
  JsonPlanAgentModel,
  RuleBasedPolicy,
  StaticLlmClient,
  VectorSemanticMemory,
  createBaseTools,
  createDemoRuntime,
  createJsonCompletion
} from "@harnesslab/core";

describe("runtime extensions", () => {
  test("JsonPlanAgentModel can drive the runtime with a provider-backed interface", async () => {
    const memory = new HybridMemory();
    const tools = createBaseTools(memory);
    let callCount = 0;
    const client = new StaticLlmClient(() => {
      callCount += 1;

      if (callCount === 1) {
        return createJsonCompletion({
          action: {
            input: {
              a: 2,
              b: 2
            },
            kind: "tool",
            tool: "math.add"
          },
          summary: "Use the calculator first."
        });
      }

      return createJsonCompletion({
        action: {
          done: true,
          kind: "respond",
          output: "The answer is 4."
        },
        summary: "Finish with the tool result."
      });
    });

    const runtime = createDemoRuntime(
      new JsonPlanAgentModel({
        client,
        tools
      }),
      {
        memory,
        tools
      }
    );
    const result = await runtime.run({
      goal: "What is 2 + 2?"
    });

    expect(result.status).toBe("completed");
    expect(result.output).toBe("The answer is 4.");
    expect(result.state.tokenUsage).toBeGreaterThan(0);
  });

  test("VectorSemanticMemory can retrieve similar notes", async () => {
    const memory = new VectorSemanticMemory(new HashedEmbeddingModel(64));
    await memory.upsert({
      content: "Harnesses add memory tracing and guardrails to agents.",
      id: "doc-1",
      payload: {
        topic: "harness"
      }
    });
    await memory.upsert({
      content: "Gardening is about soil sunlight and water.",
      id: "doc-2",
      payload: {
        topic: "garden"
      }
    });

    const results = await memory.search({
      limit: 1,
      query: "agent guardrails and tracing"
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("doc-1");
  });

  test("approval gates record pending decisions and block tool execution", async () => {
    const gate = new InMemoryApprovalGate();
    const policy = new RuleBasedPolicy(
      [
        {
          effect: "approve",
          reason: "unsafe.shell needs approval",
          tool: "unsafe.shell"
        }
      ],
      gate
    );
    const decision = await policy.allows(
      {
        input: {
          command: "rm -rf /"
        },
        tool: "unsafe.shell"
      },
      {
        runId: "run_test",
        step: 1,
        workingMemory: {}
      }
    );

    expect(decision.allowed).toBe(false);
    expect(decision.approval?.status).toBe("pending");
    expect(gate.list()).toHaveLength(1);
  });

  test("EvaluationEngine assertions surface missing tool usage", async () => {
    const engine = new EvaluationEngine(() =>
      createDemoRuntime(new BasicReflectiveModel(), {
        stepLimit: 3
      })
    );
    const report = await engine.run([
      {
        expectations: {
          expectedStatus: "completed",
          requiredTools: ["math.add"]
        },
        input: {
          goal: "Use a tool before answering."
        },
        name: "must-use-tool"
      }
    ]);

    expect(report.passed).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.cases[0]?.assertions.some((item) => item.name === "required-tool:math.add" && !item.passed)).toBe(
      true
    );
  });
});
