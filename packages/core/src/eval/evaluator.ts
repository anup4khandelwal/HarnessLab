import type { AgentInput, AgentRuntime } from "../agent/runtime";

export interface EvalCase {
  input: AgentInput;
  name: string;
  scorer?: EvalScorer;
}

export interface EvalCaseResult {
  name: string;
  passed: boolean;
  reason: string;
  score: number;
}

export interface EvalReport {
  averageScore: number;
  cases: EvalCaseResult[];
  passed: number;
  total: number;
}

export interface EvalScorerContext {
  input: AgentInput;
  output: string | undefined;
  reason: string;
  status: string;
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
      const scorer = testCase.scorer ?? defaultScorer;
      const score = await scorer({
        input: testCase.input,
        output: result.output,
        reason: result.reason,
        status: result.status
      });

      results.push({
        name: testCase.name,
        passed: score >= 0.7,
        reason: result.reason,
        score
      });
    }

    const totalScore = results.reduce((sum, current) => sum + current.score, 0);

    return {
      averageScore: results.length === 0 ? 0 : totalScore / results.length,
      cases: results,
      passed: results.filter((item) => item.passed).length,
      total: results.length
    };
  }
}
