import type { JsonValue, LearningModuleResult } from "@harnesslab/core";
import type { EvalReport } from "@harnesslab/core";

const formatJson = (value: JsonValue | undefined): string => JSON.stringify(value, null, 2);

export const printModuleResult = (slug: string, result: LearningModuleResult): void => {
  console.log(`\n[${slug}] ${result.status}`);
  console.log(result.detail);

  if (result.result !== undefined) {
    console.log(formatJson(result.result));
  }
};

export const printEvalReport = (report: EvalReport): void => {
  console.log("\n[eval]");
  console.log(`passed ${report.passed}/${report.total}`);
  console.log(`averageScore ${report.averageScore.toFixed(2)}`);

  for (const testCase of report.cases) {
    console.log(
      `${testCase.passed ? "PASS" : "FAIL"} ${testCase.name} score=${testCase.score.toFixed(2)} steps=${testCase.metrics.steps} tokens=${testCase.metrics.tokenUsage} tools=${testCase.metrics.toolCalls.join(",") || "none"}`
    );
    for (const assertion of testCase.assertions.filter((item) => !item.passed)) {
      console.log(`  - ${assertion.name}: ${assertion.detail}`);
    }
  }
};
