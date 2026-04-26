import { asJsonObject, nowIso, safeJsonStringify } from "../common";
import type { JsonObject, JsonValue } from "../common";
import type { HybridMemory } from "../memory/hybrid-memory";
import type { TraceEvent, Tracer } from "../observability/tracer";
import type { PolicyDecision, ToolPolicy } from "../policy/policy";
import type { ToolCall, ToolRegistry, ToolResult } from "../tooling/tool-registry";
import type { AgentHooks } from "./hooks";
import { LoopDetector } from "./loop-detector";
import type { LoopSignal } from "./loop-detector";

export interface AgentInput {
  context?: JsonObject;
  goal: string;
}

export interface Observation {
  input: AgentInput;
  memories: JsonValue[];
  recentEvents: TraceEvent[];
  remainingSteps: number;
  step: number;
  tokensRemaining: number;
}

export type AgentAction =
  | {
      kind: "reflect";
      note: string;
    }
  | {
      done?: boolean;
      kind: "respond";
      output: string;
    }
  | {
      input: JsonObject;
      kind: "tool";
      tool: string;
    };

export interface AgentPlan {
  action: AgentAction;
  summary: string;
}

export interface AgentModel {
  estimateTokens?(observation: Observation): number;
  name: string;
  plan(observation: Observation, state: RuntimeState): Promise<AgentPlan>;
}

export interface VerificationResult {
  done: boolean;
  message: string;
  progress: boolean;
}

export interface VerificationContext {
  lastAction: AgentAction;
  lastToolResult: ToolResult | undefined;
  state: RuntimeState;
}

export interface Verifier {
  verify(context: VerificationContext): Promise<VerificationResult>;
}

export interface TerminationSignal {
  reason: string;
  status: AgentRunStatus;
}

export interface TerminationCondition {
  check(state: RuntimeState): Promise<TerminationSignal | null> | TerminationSignal | null;
  name: string;
}

export type AgentRunStatus = "completed" | "escalated" | "failed" | "stopped";

export interface RuntimeConfig {
  autoEscalateOnLoop?: boolean;
  hooks?: AgentHooks;
  loopDetector?: LoopDetector;
  memory: HybridMemory;
  model: AgentModel;
  policy: ToolPolicy;
  stepLimit: number;
  terminationConditions?: TerminationCondition[];
  tokenBudget: number;
  tools: ToolRegistry;
  tracer: Tracer;
  verifier: Verifier;
}

export interface RuntimeState {
  completedAt: string | undefined;
  currentOutput: string | undefined;
  events: TraceEvent[];
  input: AgentInput;
  runId: string;
  startedAt: string;
  status: AgentRunStatus;
  step: number;
  tokenUsage: number;
  workingMemory: JsonObject;
}

export interface AgentRunResult {
  output: string | undefined;
  reason: string;
  state: RuntimeState;
  status: AgentRunStatus;
}

const defaultTerminationConditions = (config: RuntimeConfig): TerminationCondition[] => [
  {
    name: "step_limit",
    check: (state) =>
      state.step >= config.stepLimit
        ? {
            reason: `Step limit ${config.stepLimit} reached`,
            status: "stopped"
          }
        : null
  },
  {
    name: "token_budget",
    check: (state) =>
      state.tokenUsage >= config.tokenBudget
        ? {
            reason: `Token budget ${config.tokenBudget} exhausted`,
            status: "stopped"
          }
        : null
  }
];

export class AgentRuntime {
  private readonly config: RuntimeConfig;

  public constructor(config: RuntimeConfig) {
    this.config = config;
  }

  public async run(input: AgentInput): Promise<AgentRunResult> {
    const startedAt = nowIso();
    const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const state: RuntimeState = {
      completedAt: undefined,
      currentOutput: undefined,
      events: [],
      input,
      runId,
      startedAt,
      status: "stopped",
      step: 0,
      tokenUsage: 0,
      workingMemory: {}
    };

    await this.config.tracer.startRun(state);
    await this.pushEvent(state, "run_started", {
      goal: input.goal,
      startedAt
    });

    try {
      while (true) {
        const termination = await this.evaluateTermination(state);

        if (termination !== null) {
          return this.complete(state, termination.status, termination.reason);
        }

        state.step += 1;
        const observation = await this.observe(state);
        const plannedTokens = this.config.model.estimateTokens?.(observation) ?? 64;
        state.tokenUsage += plannedTokens;

        await this.pushEvent(state, "observe", {
          memories: observation.memories,
          remainingSteps: observation.remainingSteps,
          step: observation.step,
          tokensRemaining: observation.tokensRemaining
        });

        const plan = await this.config.model.plan(observation, state);

        await this.pushEvent(state, "plan", {
          action: plan.action,
          summary: plan.summary
        });

        const actResult = await this.act(plan.action, state);
        const verification = await this.config.verifier.verify({
          lastAction: plan.action,
          lastToolResult: actResult.toolResult,
          state
        });

        await this.pushEvent(state, "verify", {
          done: verification.done,
          message: verification.message,
          progress: verification.progress
        });

        const loopSignal = this.checkLoop(state, plan.action, actResult.toolResult, verification);

        if (loopSignal !== null && this.config.autoEscalateOnLoop !== false) {
          await this.pushEvent(state, "escalation", {
            kind: loopSignal.kind,
            message: loopSignal.message
          });

          return this.complete(state, "escalated", loopSignal.message);
        }

        if (plan.action.kind === "respond") {
          state.currentOutput = plan.action.output;
        }

        if (verification.done || (plan.action.kind === "respond" && plan.action.done === true)) {
          return this.complete(state, "completed", verification.message);
        }
      }
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      await this.config.hooks?.onFailure?.({
        error,
        state
      });
      await this.config.tracer.recordFailure(state.runId, error, state.step);
      await this.pushEvent(state, "failure", {
        message: error.message,
        name: error.name
      });

      return this.complete(state, "failed", error.message);
    }
  }

  private async observe(state: RuntimeState): Promise<Observation> {
    const memories = await this.config.memory.recall({
      limit: 3,
      query: state.input.goal
    });

    return {
      input: state.input,
      memories: memories.map((memory) => memory.payload),
      recentEvents: state.events.slice(-6),
      remainingSteps: this.config.stepLimit - state.step,
      step: state.step,
      tokensRemaining: this.config.tokenBudget - state.tokenUsage
    };
  }

  private async act(
    action: AgentAction,
    state: RuntimeState
  ): Promise<{
    toolResult?: ToolResult;
  }> {
    if (action.kind === "reflect") {
      state.workingMemory.lastReflection = action.note;
      await this.pushEvent(state, "act", {
        note: action.note,
        type: "reflection"
      });

      return {};
    }

    if (action.kind === "respond") {
      await this.pushEvent(state, "act", {
        output: action.output,
        type: "response"
      });

      return {};
    }

    const call: ToolCall = {
      input: action.input,
      tool: action.tool
    };

    await this.config.hooks?.beforeToolCall?.({
      call,
      state
    });

    const decision = await this.config.policy.allows(call, {
      runId: state.runId,
      step: state.step,
      workingMemory: state.workingMemory
    });

    this.assertPolicy(decision);

    await this.pushEvent(state, "tool_requested", {
      input: call.input,
      tool: call.tool
    });

    const result = await this.config.tools.invoke(call, {
      runId: state.runId,
      step: state.step,
      workingMemory: state.workingMemory
    });

    state.workingMemory.lastToolResult = asJsonObject(result.output);
    await this.config.memory.rememberToolResult(state.runId, state.step, call, result);
    await this.config.hooks?.afterToolCall?.({
      call,
      result,
      state
    });

    await this.pushEvent(state, "tool_result", {
      ok: result.ok,
      output: result.output ?? null,
      tool: call.tool
    });

    return {
      toolResult: result
    };
  }

  private checkLoop(
    state: RuntimeState,
    action: AgentAction,
    toolResult: ToolResult | undefined,
    verification: VerificationResult
  ): LoopSignal | null {
    const signature =
      action.kind === "tool"
        ? `${action.tool}:${safeJsonStringify(action.input)}:${safeJsonStringify(toolResult?.output)}`
        : undefined;

    const fingerprint: JsonObject = {
      output: state.currentOutput ?? null,
      progress: verification.progress,
      status: state.status,
      toolResult: toolResult?.output ?? null,
      workingMemory: state.workingMemory
    };

    return (this.config.loopDetector ?? new LoopDetector()).record({
      stateFingerprint: fingerprint,
      toolSignature: signature
    });
  }

  private async evaluateTermination(state: RuntimeState): Promise<TerminationSignal | null> {
    const conditions = [
      ...defaultTerminationConditions(this.config),
      ...(this.config.terminationConditions ?? [])
    ];

    for (const condition of conditions) {
      const signal = await condition.check(state);

      if (signal !== null) {
        await this.pushEvent(state, "termination", {
          condition: condition.name,
          reason: signal.reason,
          status: signal.status
        });

        return signal;
      }
    }

    return null;
  }

  private assertPolicy(decision: PolicyDecision): void {
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
  }

  private async complete(
    state: RuntimeState,
    status: AgentRunStatus,
    reason: string
  ): Promise<AgentRunResult> {
    state.completedAt = nowIso();
    state.status = status;

    const result: AgentRunResult = {
      output: state.currentOutput,
      reason,
      state,
      status
    };

    await this.pushEvent(state, "run_completed", {
      output: state.currentOutput ?? null,
      reason,
      status
    });
    await this.config.tracer.completeRun(result);
    await this.config.hooks?.onCompletion?.({
      result,
      state
    });

    return result;
  }

  private async pushEvent(state: RuntimeState, type: string, payload: JsonValue): Promise<void> {
    const event: TraceEvent = {
      payload,
      runId: state.runId,
      step: state.step,
      timestamp: nowIso(),
      type
    };

    state.events.push(event);
    await this.config.memory.rememberEvent(event);
    await this.config.tracer.recordEvent(event);
  }
}

export class DefaultVerifier implements Verifier {
  public async verify(context: VerificationContext): Promise<VerificationResult> {
    if (context.lastAction.kind === "respond") {
      return {
        done: context.lastAction.done ?? true,
        message: "Model emitted a final response",
        progress: context.lastAction.output.trim().length > 0
      };
    }

    if (context.lastAction.kind === "tool") {
      return {
        done: false,
        message: context.lastToolResult?.ok
          ? "Tool call succeeded, continue the loop"
          : "Tool call failed, recover or escalate",
        progress: context.lastToolResult?.ok ?? false
      };
    }

    return {
      done: false,
      message: "Reflection recorded, continue the loop",
      progress: context.lastAction.note.trim().length > 0
    };
  }
}
