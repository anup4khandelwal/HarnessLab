import { safeJsonStringify } from "../common";
import type { JsonObject, JsonValue } from "../common";
import { validateAgainstSchema } from "./json-schema";
import type { JsonSchema } from "./json-schema";

export interface ToolContext {
  runId: string;
  step: number;
  workingMemory: JsonObject;
}

export interface ToolCall {
  input: JsonObject;
  tool: string;
}

export interface ToolResult {
  durationMs: number;
  error?: string;
  ok: boolean;
  output?: JsonValue;
}

export interface ToolDefinition<TInput extends JsonObject = JsonObject, TOutput extends JsonValue = JsonValue> {
  description: string;
  execute(input: TInput, context: ToolContext): Promise<TOutput> | TOutput;
  name: string;
  schema: JsonSchema;
  timeoutMs?: number;
}

export class ToolExecutionError extends Error {}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  public register(definition: ToolDefinition): void {
    this.tools.set(definition.name, definition);
  }

  public list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public async invoke(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.tool);

    if (tool === undefined) {
      throw new ToolExecutionError(`Unknown tool: ${call.tool}`);
    }

    const validation = validateAgainstSchema(call.input, tool.schema);

    if (!validation.valid) {
      throw new ToolExecutionError(`Schema validation failed for ${call.tool}: ${validation.errors.join(", ")}`);
    }

    const startedAt = performance.now();

    try {
      const output = await promiseWithTimeout(
        Promise.resolve(tool.execute(call.input, context)),
        tool.timeoutMs ?? 3_000,
        `${call.tool} timed out`
      );

      return {
        durationMs: performance.now() - startedAt,
        ok: true,
        output
      };
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(safeJsonStringify(cause as JsonValue));

      return {
        durationMs: performance.now() - startedAt,
        error: error.message,
        ok: false
      };
    }
  }
}

const promiseWithTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new ToolExecutionError(timeoutMessage)), timeoutMs);
    })
  ]);

