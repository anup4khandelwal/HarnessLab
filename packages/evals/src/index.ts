export interface ScenarioAssertion {
  detail: string;
  name: string;
  passed: boolean;
}

export interface ScenarioDefinition<TResult> {
  expected: string;
  name: string;
  run(): Promise<TResult> | TResult;
  validate(result: TResult): ScenarioAssertion[];
}

export interface ScenarioResult {
  assertions: ScenarioAssertion[];
  durationMs: number;
  expected: string;
  name: string;
  passed: boolean;
}

export interface ScenarioReport {
  failed: number;
  passed: number;
  results: ScenarioResult[];
  total: number;
}

export class ScenarioEvalEngine {
  public async run<TResult>(scenarios: ScenarioDefinition<TResult>[]): Promise<ScenarioReport> {
    const results: ScenarioResult[] = [];

    for (const scenario of scenarios) {
      const startedAtMs = performance.now();
      const value = await scenario.run();
      const assertions = scenario.validate(value);
      results.push({
        assertions,
        durationMs: performance.now() - startedAtMs,
        expected: scenario.expected,
        name: scenario.name,
        passed: assertions.every((assertion) => assertion.passed)
      });
    }

    return {
      failed: results.filter((result) => !result.passed).length,
      passed: results.filter((result) => result.passed).length,
      results,
      total: results.length
    };
  }
}

