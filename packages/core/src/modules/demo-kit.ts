import { AgentRuntime, DefaultVerifier } from "../agent/runtime";
import type {
  AgentInput,
  AgentModel,
  AgentPlan,
  Observation,
  RuntimeConfig
} from "../agent/runtime";
import { LoopDetector } from "../agent/loop-detector";
import { EvaluationEngine } from "../eval/evaluator";
import type { EvalCase, EvalReport } from "../eval/evaluator";
import { HybridMemory } from "../memory/hybrid-memory";
import { InMemoryTracer } from "../observability/tracer";
import { AllowAllPolicy, StaticApprovalGate, RuleBasedPolicy } from "../policy/policy";
import { ToolRegistry } from "../tooling/tool-registry";
import { asJsonObject } from "../common";
import type { JsonObject, JsonValue } from "../common";
import type { ToolDefinition } from "../tooling/tool-registry";

export interface LearningModuleResult {
  detail: string;
  result?: JsonValue;
  status: "failure_demo" | "success";
}

export interface LearningModule {
  description: string;
  failureMode: string;
  run(): Promise<LearningModuleResult>;
  slug: string;
  title: string;
}

export const createBaseTools = (memory: HybridMemory): ToolRegistry => {
  const registry = new ToolRegistry();
  const mathAddTool: ToolDefinition<{ a: number; b: number }, { sum: number }> = {
    description: "Add two numbers together.",
    execute: async (input) => ({
      sum: input.a + input.b
    }),
    name: "math.add",
    schema: {
      properties: {
        a: { type: "number" },
        b: { type: "number" }
      },
      required: ["a", "b"],
      type: "object"
    }
  };
  const memoryStoreTool: ToolDefinition<{ note: string }, { stored: boolean }> = {
    description: "Store a note into semantic memory.",
    execute: async (input) => {
      await memory.rememberNote(input.note, {
        note: input.note
      });

      return {
        stored: true
      };
    },
    name: "memory.store",
    schema: {
      properties: {
        note: { type: "string" }
      },
      required: ["note"],
      type: "object"
    }
  };
  const unsafeShellTool: ToolDefinition<{ command: string }, { command: string; executed: boolean }> = {
    description: "A deliberately unsafe shell-like tool used to demonstrate guardrails.",
    execute: async (input) => ({
      command: input.command,
      executed: false
    }),
    name: "unsafe.shell",
    schema: {
      properties: {
        command: { type: "string" }
      },
      required: ["command"],
      type: "object"
    }
  };

  registry.register(mathAddTool);
  registry.register(memoryStoreTool);
  registry.register(unsafeShellTool);

  return registry;
};

export const createDemoRuntime = (
  model: AgentModel,
  overrides: Partial<RuntimeConfig> = {}
): AgentRuntime => {
  const memory = overrides.memory ?? new HybridMemory();
  const tracer = overrides.tracer ?? new InMemoryTracer();
  const config: RuntimeConfig = {
    autoEscalateOnLoop: true,
    loopDetector: overrides.loopDetector ?? new LoopDetector(),
    memory,
    model,
    policy: overrides.policy ?? new AllowAllPolicy(),
    stepLimit: overrides.stepLimit ?? 6,
    terminationConditions: overrides.terminationConditions ?? [],
    tokenBudget: overrides.tokenBudget ?? 512,
    tools: overrides.tools ?? createBaseTools(memory),
    tracer,
    verifier: overrides.verifier ?? new DefaultVerifier()
  };

  if (overrides.hooks !== undefined) {
    config.hooks = overrides.hooks;
  }

  return new AgentRuntime(config);
};

export const buildPromptLikeSummary = (observation: Observation): string =>
  [
    `goal=${observation.input.goal}`,
    `step=${observation.step}`,
    `memories=${observation.memories.length}`,
    `tokensRemaining=${observation.tokensRemaining}`
  ].join(" | ");

export class LoopingModel implements AgentModel {
  public readonly name = "looping-model";

  public async plan(observation: Observation): Promise<AgentPlan> {
    return {
      action: {
        input: {
          a: 2,
          b: 2
        },
        kind: "tool",
        tool: "math.add"
      },
      summary: `Retrying the same calculation. ${buildPromptLikeSummary(observation)}`
    };
  }
}

export class BasicReflectiveModel implements AgentModel {
  public readonly name = "basic-reflective-model";

  public async plan(observation: Observation): Promise<AgentPlan> {
    return {
      action: {
        kind: "reflect",
        note: `Thinking without a harness. ${buildPromptLikeSummary(observation)}`
      },
      summary: "Reflect again instead of finishing."
    };
  }
}

export class SafeMathModel implements AgentModel {
  public readonly name = "safe-math-model";

  public async plan(observation: Observation, state: { workingMemory: JsonObject }): Promise<AgentPlan> {
    const lastToolResult = asJsonObject(state.workingMemory.lastToolResult);
    const lastSum = lastToolResult.sum;

    if (typeof lastSum === "number") {
      return {
        action: {
          done: true,
          kind: "respond",
          output: `The answer is ${lastSum}.`
        },
        summary: "Use the tool result and finish."
      };
    }

    return {
      action: {
        input: {
          a: 2,
          b: 2
        },
        kind: "tool",
        tool: "math.add"
      },
      summary: `Use a tool before responding. ${buildPromptLikeSummary(observation)}`
    };
  }
}

export class UnsafeModel implements AgentModel {
  public readonly name = "unsafe-model";

  public async plan(): Promise<AgentPlan> {
    return {
      action: {
        input: {
          command: "rm -rf /"
        },
        kind: "tool",
        tool: "unsafe.shell"
      },
      summary: "Attempt an unsafe action so the policy layer blocks it."
    };
  }
}

export class MemoryModel implements AgentModel {
  public readonly name = "memory-model";

  public async plan(observation: Observation): Promise<AgentPlan> {
    if (observation.memories.length === 0) {
      return {
        action: {
          input: {
            note: "Harnesses improve agents by adding tools, memory, and guardrails."
          },
          kind: "tool",
          tool: "memory.store"
        },
        summary: "Store a note before trying to recall it."
      };
    }

    return {
      action: {
        done: true,
        kind: "respond",
        output: `I remembered: ${JSON.stringify(observation.memories[0])}`
      },
      summary: "Use recalled memory in the final response."
    };
  }
}

export class SchemaFailureModel implements AgentModel {
  public readonly name = "schema-failure-model";

  public async plan(): Promise<AgentPlan> {
    return {
      action: {
        input: {
          a: "2",
          b: 2
        } as unknown as JsonObject,
        kind: "tool",
        tool: "math.add"
      },
      summary: "Trigger schema validation failure with the wrong argument type."
    };
  }
}

export interface FullAgentHarness {
  eval(cases: EvalCase[]): Promise<EvalReport>;
  run(input?: AgentInput): Promise<LearningModuleResult>;
  tracer: InMemoryTracer;
}

export const createFullAgentHarness = (): FullAgentHarness => {
  const memory = new HybridMemory();
  const tracer = new InMemoryTracer();
  const policy = new RuleBasedPolicy(
    [
      {
        effect: "deny",
        reason: "unsafe.shell is blocked in the production harness",
        tool: "unsafe.shell"
      }
    ],
    new StaticApprovalGate(false)
  );

  const runtimeFactory = () =>
    createDemoRuntime(new SafeMathModel(), {
      loopDetector: new LoopDetector({
        noProgressThreshold: 2,
        repeatedToolThreshold: 2
      }),
      memory,
      policy,
      stepLimit: 5,
      tracer,
      tools: createBaseTools(memory)
    });

  return {
    eval: async (cases) => new EvaluationEngine(runtimeFactory).run(cases),
    run: async (input = { goal: "What is 2 + 2?" }) => {
      const result = await runtimeFactory().run(input);

      return {
        detail: result.reason,
        result: {
          output: result.output ?? null,
          status: result.status,
          traceEvents: tracer.listRuns().flatMap((run) => run.events).length
        },
        status: result.status === "completed" ? "success" : "failure_demo"
      };
    },
    tracer
  };
};
