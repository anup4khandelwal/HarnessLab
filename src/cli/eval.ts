import { createFullAgentHarness } from "@harnesslab/core";
import { evalCases } from "../../modules/07_eval";
import { printEvalReport } from "./format";

const harness = createFullAgentHarness();
const report = await harness.eval(evalCases);

printEvalReport(report);

