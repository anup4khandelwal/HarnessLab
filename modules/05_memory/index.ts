import { HybridMemory, MemoryModel, createBaseTools, createDemoRuntime } from "@harnesslab/core";
import type {
  JsonValue,
  LearningModule,
  SemanticDocument,
  SemanticMemoryStore,
  SemanticSearchQuery,
  SemanticSearchResult
} from "@harnesslab/core";

const FIX_MEMORY = false;

class EmptySemanticMemory implements SemanticMemoryStore {
  public async search(_query: SemanticSearchQuery): Promise<SemanticSearchResult[]> {
    return [];
  }

  public async upsert(_document: SemanticDocument): Promise<void> {}
}

export const memoryModule: LearningModule = {
  description: "Demonstrates hybrid memory with event logs and semantic recall.",
  failureMode: "Without semantic recall, the model stores notes but never sees them again, so it makes no progress.",
  async run() {
    const memory = FIX_MEMORY ? new HybridMemory() : new HybridMemory({ semanticMemory: new EmptySemanticMemory() });
    const runtime = createDemoRuntime(new MemoryModel(), {
      memory,
      tools: createBaseTools(memory)
    });
    const result = await runtime.run({
      goal: "Remember what a harness adds to a model."
    });

    return {
      detail: FIX_MEMORY
        ? "Semantic recall enabled. The model can retrieve what it stored."
        : "Failure demo: event memory exists, but semantic recall is empty, so the agent loops. Swap in the default HybridMemory to fix it.",
      result: {
        output: result.output ?? null,
        recalled: memory.eventMemory.list(result.state.runId).length,
        reason: result.reason,
        status: result.status
      } satisfies JsonValue,
      status: FIX_MEMORY ? "success" : "failure_demo"
    };
  },
  slug: "05_memory",
  title: "05 Memory"
};

export default memoryModule;

