import basicAgentModule from "../../modules/01_basic_agent";
import loopFixModule from "../../modules/02_loop_fix";
import toolsModule from "../../modules/03_tools";
import guardrailsModule from "../../modules/04_guardrails";
import memoryModule from "../../modules/05_memory";
import observabilityModule from "../../modules/06_observability";
import evalModule from "../../modules/07_eval";
import fullAgentModule from "../../modules/08_full_agent";
import type { LearningModule } from "@harnesslab/core";

export const moduleCatalog: LearningModule[] = [
  basicAgentModule,
  loopFixModule,
  toolsModule,
  guardrailsModule,
  memoryModule,
  observabilityModule,
  evalModule,
  fullAgentModule
];

export const getModuleBySlug = (slug: string): LearningModule | undefined =>
  moduleCatalog.find((module) => module.slug === slug);

