# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install          # install all workspace dependencies
bun run typecheck    # TypeScript type check (no emit)
bun test             # run all tests
```

Run a single test file:
```bash
bun test tests/runtime.test.ts
```

Run a specific named test:
```bash
bun test --test-name-pattern "completes a safe math run"
```

CLI entrypoints:
```bash
bun run module 01_basic_agent   # run a numbered learning module by slug
bun run agent                   # run the harnessed agent CLI
bun run eval                    # run the core harness eval suite
bun run inference               # run the inference runtime demo
bun run api                     # start the Hono API on http://localhost:3001
bun run web                     # start the optional TanStack UI shell
```

## Architecture

HarnessLab models two separate but connected systems:

**Agent control plane** (`@harnesslab/core`): policies, memory, tracing, evals, loop detection, tool execution.

**Inference simulation** (`@harnesslab/inference`, `@harnesslab/inference-runtime`): prefill/decode separation, KV-cache growth, batching, speculative decoding, replayable traces.

### Agent Runtime Loop

`AgentRuntime` (`packages/core/src/agent/runtime.ts`) drives the canonical loop:

```
observe → plan → act → verify → repeat
```

Each iteration:
1. `observe()` pulls recent events and semantic memory recalls.
2. `model.plan()` proposes the next `AgentAction` — one of `reflect | tool | respond`.
3. `act()` passes tool calls through `ToolPolicy` before executing via `ToolRegistry`. Policy can `allow`, `deny`, or `require_approval`. Denied calls throw and the run enters `failed`.
4. `verifier.verify()` decides whether to continue or halt.
5. `LoopDetector` fingerprints state after each step and escalates on repeated tool signatures or no-progress stagnation.
6. `TerminationCondition`s (default: step limit, token budget) are checked before each step.

Run statuses: `completed | stopped | escalated | failed`.

### AgentModel Interface

`AgentModel.plan(observation, state)` returns an `AgentPlan`. Two implementations:

- **Deterministic stubs** (in `packages/core/src/modules/demo-kit.ts`): `SafeMathModel`, `LoopingModel`, `BasicReflectiveModel`, `UnsafeModel`, `MemoryModel`. Used by all modules and tests without any API key.
- **`JsonPlanAgentModel`** (`packages/core/src/agent/llm-model.ts`): calls an `LlmClient` and parses a JSON action object from the response. Used when `HARNESSLAB_LLM_API_KEY` and `HARNESSLAB_LLM_MODEL` are set.

### Harness Factory Helpers (demo-kit.ts)

`createDemoRuntime(model, overrides?)` — minimal runtime with sensible defaults, used in tests and modules.

`createConfiguredHarness(options?)` / `createFullAgentHarness()` — full harness with `RuleBasedPolicy`, `HybridMemory` (vector embeddings), `InMemoryTracer`, and an `EvaluationEngine`.

`createOpenAICompatibleHarness(options)` / `createOpenAICompatibleHarnessFromEnv(env)` — switches the model to `JsonPlanAgentModel` when LLM credentials are available.

### Policy System

`RuleBasedPolicy` (`packages/core/src/policy/policy.ts`) evaluates `PolicyRule[]` in order. Each rule matches by `tool`, `name`, `actionKind`, and/or a custom `match` function, then applies `allow | deny | require_approval`. An `ApprovalGate` (e.g. `StaticApprovalGate`, `InMemoryApprovalGate`) handles `require_approval` rules. Default behavior (no matching rule) is `allow`.

### Memory

`HybridMemory` (`packages/core/src/memory/hybrid-memory.ts`) composes:
- `InMemoryEventMemory` — append-only trace event log.
- `SemanticMemoryStore` — keyword-based by default (`KeywordSemanticMemory`), swappable for `VectorSemanticMemory` with a `HashedEmbeddingModel` or `OpenAICompatibleEmbeddingModel`.
- Optional `KnowledgeGraphStore`.

### Inference Engine

`runInference(request)` (`packages/inference/src/tokenLoop.ts`) is an async generator:

```ts
const { event: prefillEvent, state } = await prefill(request)  // loads context
while (!state.done) {
  const result = await decode(state)                            // emits one token
  if (result.event) yield result.event
}
yield buildCompletionEvent(state, finishReason)
```

Termination: stop-token match, `maxTokens` exhaustion, or exhausted `generationPlan`.

`runSpeculativeDecode` (`packages/inference/src/speculative.ts`) simulates draft-token verification and reports acceptance rate.

### Inference Runtime

`InferenceRuntime` (`packages/inference-runtime/src/runtime.ts`) wraps the inference engine as a request-oriented serving layer:

- `submit(input)` → returns a snapshot immediately, schedules work via `RequestScheduler`.
- `stream(requestId)` → async generator of `InferenceRuntimeEvent` (lifecycle + token events).
- `cancel(requestId)` → cancels queued or in-flight requests.
- `getReplay(requestId)` → returns the `ReplayRecorder` trace.
- `getBatchHistory()` → batch metadata including per-request queue times.

Request lifecycle: `queued → running → completed | failed | cancelled`.

### Learning Modules

Each module in `modules/` exports a `LearningModule` and uses a top-level `const ENABLE_HARNESS = false` (or similar) constant to toggle between the broken and fixed behavior. Flip the constant to see the corrected implementation.

Modules are registered in `src/cli/module-registry.ts` and served by `GET /modules` + `POST /run/:slug` in the API.

## TypeScript Conventions

The project uses strict TypeScript with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `verbatimModuleSyntax`. Type imports must use `import type`. Array index access returns `T | undefined`; guard before use. Optional properties must not be set to `undefined` explicitly — omit them instead.

Workspace package aliases (e.g. `@harnesslab/core`) are resolved via `tsconfig.json` `paths` mappings, not `node_modules` symlinks. Bun resolves them directly.

## Environment Variables (Provider-Backed Mode)

Without any env vars the project is fully deterministic (no network). To switch to a real LLM:

```bash
export HARNESSLAB_LLM_API_KEY=...
export HARNESSLAB_LLM_MODEL=gpt-4.1-mini
export HARNESSLAB_LLM_BASE_URL=https://api.openai.com/v1   # optional
export HARNESSLAB_EMBEDDING_MODEL=text-embedding-3-small   # optional
export HARNESSLAB_EMBEDDING_API_KEY=...                    # optional
export HARNESSLAB_EMBEDDING_BASE_URL=...                   # optional
```

`createOpenAICompatibleHarnessFromEnv(process.env)` returns `undefined` when the required keys are absent, so callers fall back to the deterministic harness.
