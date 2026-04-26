import { createFullAgentHarness } from "@harnesslab/core";
import { printModuleResult } from "./format";

const goal = Bun.argv.slice(2).join(" ").trim() || "Use the harness runtime to solve 2 + 2.";
const harness = createFullAgentHarness();
const result = await harness.run({
  goal
});

printModuleResult("agent", result);

