import type { ToolCall, ToolResult } from "../tooling/tool-registry";
import type { AgentRunResult, RuntimeState } from "./runtime";

export interface BeforeToolCallContext {
  call: ToolCall;
  state: RuntimeState;
}

export interface AfterToolCallContext {
  call: ToolCall;
  result: ToolResult;
  state: RuntimeState;
}

export interface FailureHookContext {
  error: Error;
  state: RuntimeState;
}

export interface CompletionHookContext {
  result: AgentRunResult;
  state: RuntimeState;
}

export interface AgentHooks {
  afterToolCall?(context: AfterToolCallContext): Promise<void> | void;
  beforeToolCall?(context: BeforeToolCallContext): Promise<void> | void;
  onCompletion?(context: CompletionHookContext): Promise<void> | void;
  onFailure?(context: FailureHookContext): Promise<void> | void;
}

