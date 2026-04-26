import type { TraceEvent } from "../observability/tracer";
import type { AgentInput, AgentRunStatus, AgentRuntime } from "../agent/runtime";

export interface EvalCase {
  expectations?: EvalExpectations;
  input: AgentInput;
  name: string;
  scorer?: EvalScorer;
}

export interface EvalExpectations {
  expectedStatus?: AgentRunStatus;
  maxSteps?: number;
  maxTokenUsage?: number;
  minTraceEvents?: number;
  outputExcludes?: string[];
  outputIncludes?: string[];
  requiredTools?: string[];
}

export interface EvalAssertionResult {
  detail: string;
  name: string;
  passed: boolean;
  score: number;
}

export interface EvalMetrics {
  steps: number;
  tokenUsage: number;
  toolCalls: string[];
  traceEvents: number;
}

export interface EvalCaseResult {
  assertions: EvalAssertionResult[];
  metrics: EvalMetrics;
  name: string;
  output: string | undefined;
  passed: boolean;
  reason: string;
  score: number;
}

export interface EvalReport {
  averageScore: number;
  cases: EvalCaseResult[];
  failed: number;
  passed: number;
  total: number;
}

export interface EvalScorerContext {
  events: TraceEvent[];
  input: AgentInput;
  metrics: EvalMetrics;
  output: string | undefined;
  reason: string;
  status: string;
  toolCalls: string[];
}

export type EvalScorer = (context: EvalScorerContext) => Promise<number> | number;

const defaultScorer: EvalScorer = (context) =>
  context.status === "completed" && (context.output?.trim().length ?? 0) > 0 ? 1 : 0;

export class EvaluationEngine {
  private readonly runtimeFactory: () => AgentRuntime;

  public constructor(runtimeFactory: () => AgentRuntime) {
    this.runtimeFactory = runtimeFactory;
  }

  public async run(cases: EvalCase[]): Promise<EvalReport> {
    const results: EvalCaseResult[] = [];

    for (const testCase of cases) {
      const runtime = this.runtimeFactory();
      const result = await runtime.run(testCase.input);
      const metrics = collectMetrics(result.state.events, result.state.step, result.state.tokenUsage);
      const assertions = buildAssertions(
        testCase,
        result.output,
        result.reason,
        result.status,
        result.state.events,
        metrics,
        testCase.scorer !== undefined
      );
      const scorer = testCase.scorer ?? defaultScorer;
      const customScore = await scorer({
        events: result.state.events,
        input: testCase.input,
        metrics,
        output: result.output,
        reason: result.reason,
        status: result.status,
        toolCalls: metrics.toolCalls
      });
      assertions.push({
        detail: `Custom scorer returned ${customScore.toFixed(2)}`,
        name: "custom-scorer",
        passed: customScore >= 0.7,
        score: customScore
      });
      const score =
        assertions.length === 0
          ? customScore
          : assertions.reduce((sum, assertion) => sum + assertion.score, 0) / assertions.length;

      results.push({
        assertions,
        metrics,
        name: testCase.name,
        passed: score >= 0.7,
        output: result.output,
        reason: result.reason,
        score
      });
    }

    const totalScore = results.reduce((sum, current) => sum + current.score, 0);

    return {
      averageScore: results.length === 0 ? 0 : totalScore / results.length,
      cases: results,
      failed: results.filter((item) => !item.passed).length,
      passed: results.filter((item) => item.passed).length,
      total: results.length
    };
  }
}

const collectMetrics = (events: TraceEvent[], steps: number, tokenUsage: number): EvalMetrics => ({
  steps,
  tokenUsage,
  toolCalls: events
    .filter((event) => event.type === "tool_requested")
    .map((event) => {
      const tool = (event.payload as { tool?: unknown }).tool;
      return typeof tool === "string" ? tool : "unknown";
    }),
  traceEvents: events.length
});

const buildAssertions = (
  testCase: EvalCase,
  output: string | undefined,
  reason: string,
  status: string,
  events: TraceEvent[],
  metrics: EvalMetrics,
  hasCustomScorer: boolean
): EvalAssertionResult[] => {
  const assertions: EvalAssertionResult[] = [];
  const expectations = testCase.expectations;

  if (expectations?.expectedStatus !== undefined) {
    assertions.push({
      detail: `Expected status ${expectations.expectedStatus}, received ${status}`,
      name: "expected-status",
      passed: status === expectations.expectedStatus,
      score: status === expectations.expectedStatus ? 1 : 0
    });
  }

  for (const snippet of expectations?.outputIncludes ?? []) {
    const passed = output?.includes(snippet) ?? false;
    assertions.push({
      detail: `Output must include ${JSON.stringify(snippet)}`,
      name: `output-includes:${snippet}`,
      passed,
      score: passed ? 1 : 0
    });
  }

  for (const snippet of expectations?.outputExcludes ?? []) {
    const passed = !(output?.includes(snippet) ?? false);
    assertions.push({
      detail: `Output must not include ${JSON.stringify(snippet)}`,
      name: `output-excludes:${snippet}`,
      passed,
      score: passed ? 1 : 0
    });
  }

  for (const tool of expectations?.requiredTools ?? []) {
    const passed = metrics.toolCalls.includes(tool);
    assertions.push({
      detail: `Tool calls must include ${tool}`,
      name: `required-tool:${tool}`,
      passed,
      score: passed ? 1 : 0
    });
  }

  if (expectations?.maxSteps !== undefined) {
    const passed = metrics.steps <= expectations.maxSteps;
    assertions.push({
      detail: `Expected at most ${expectations.maxSteps} steps, received ${metrics.steps}`,
      name: "max-steps",
      passed,
      score: passed ? 1 : 0
    });
  }

  if (expectations?.maxTokenUsage !== undefined) {
    const passed = metrics.tokenUsage <= expectations.maxTokenUsage;
    assertions.push({
      detail: `Expected token usage <= ${expectations.maxTokenUsage}, received ${metrics.tokenUsage}`,
      name: "max-token-usage",
      passed,
      score: passed ? 1 : 0
    });
  }

  if (expectations?.minTraceEvents !== undefined) {
    const passed = metrics.traceEvents >= expectations.minTraceEvents;
    assertions.push({
      detail: `Expected at least ${expectations.minTraceEvents} trace events, received ${metrics.traceEvents}`,
      name: "min-trace-events",
      passed,
      score: passed ? 1 : 0
    });
  }

  if (assertions.length === 0 && !hasCustomScorer) {
    const score = defaultScorer({
      events,
      input: testCase.input,
      metrics,
      output,
      reason,
      status,
      toolCalls: metrics.toolCalls
    });
    const numericScore = typeof score === "number" ? score : 0;
    assertions.push({
      detail: "Default evaluation fallback",
      name: "default-scorer",
      passed: numericScore >= 0.7,
      score: numericScore
    });
  }

  return assertions;
};
