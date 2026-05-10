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

## Repository Layout

```
apps/
  api/src/index.ts           # Hono API server (port 3001)
  web/src/                   # TanStack Router + React UI
modules/
  01_basic_agent/            # Learning module 1 — basic agent setup
  02_loop_fix/               # Learning module 2 — loop detection
  03_tools/                  # Learning module 3 — tool integration
  04_guardrails/             # Learning module 4 — policy guardrails
  05_memory/                 # Learning module 5 — hybrid memory
  06_observability/          # Learning module 6 — tracing
  07_eval/                   # Learning module 7 — evaluation framework
  08_full_agent/             # Learning module 8 — complete agent
  09_prefix_cache/           # Learning module 9 — prefix cache optimization
packages/
  core/                      # Agent control plane
  inference/                 # Token generation engine
  inference-runtime/         # Request-oriented serving layer
  memory/                    # KV-cache and prefix-cache simulators
  evals/                     # Evaluation framework helpers
  metrics/                   # Request metrics and telemetry
  replay/                    # Trace replay system
  scheduler/                 # Request scheduling
src/cli/
  agent.ts                   # Harnessed agent CLI
  eval.ts                    # Eval suite CLI
  inference.ts               # Inference demo CLI
  module.ts                  # Module runner CLI
  module-registry.ts         # Catalog of all 9 learning modules
  format.ts                  # Output formatting utilities
tests/
  runtime.test.ts            # Core runtime loop tests
  control-plane.test.ts      # Agent control-plane tests
  runtime-extensions.test.ts # Runtime extension tests
  inference-runtime.test.ts  # Inference runtime tests
  prefix-cache.test.ts       # Prefix cache tests
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

### Key Types (runtime.ts)

```ts
interface AgentInput    { goal: string; context?: JsonObject }
interface Observation   { input, memories, recentEvents, remainingSteps, step, tokensRemaining }
type AgentAction        = { kind: "reflect"; note } | { kind: "respond"; output; done? } | { kind: "tool"; tool; input }
interface AgentPlan     { action: AgentAction; summary: string }
interface RuntimeState  { runId, step, status, events, tokenUsage, workingMemory, input, ... }
interface AgentRunResult { status, output, reason, state }
interface RuntimeConfig { model, memory, policy, tools, tracer, verifier, stepLimit, tokenBudget, ... }
```

### AgentModel Interface

`AgentModel.plan(observation, state)` returns an `AgentPlan`. Two implementations:

- **Deterministic stubs** (in `packages/core/src/modules/demo-kit.ts`): `SafeMathModel`, `LoopingModel`, `BasicReflectiveModel`, `UnsafeModel`, `MemoryModel`. Used by all modules and tests without any API key.
- **`JsonPlanAgentModel`** (`packages/core/src/agent/llm-model.ts`): calls an `LlmClient` and parses a JSON action object from the response. Used when `HARNESSLAB_LLM_API_KEY` and `HARNESSLAB_LLM_MODEL` are set.

### AgentHooks

`AgentHooks` (`packages/core/src/agent/hooks.ts`) is an optional lifecycle interface on `RuntimeConfig`:

```ts
interface AgentHooks {
  beforeToolCall?(context: { call, state }): Promise<void> | void;
  afterToolCall?(context:  { call, result, state }): Promise<void> | void;
  onCompletion?(context:   { result, state }): Promise<void> | void;
  onFailure?(context:      { error, state }): Promise<void> | void;
}
```

### Harness Factory Helpers (demo-kit.ts)

`createDemoRuntime(model, overrides?)` — minimal runtime with sensible defaults, used in tests and modules.

`createConfiguredHarness(options?)` / `createFullAgentHarness()` — full harness with `RuleBasedPolicy`, `HybridMemory` (vector embeddings), `InMemoryTracer`, and an `EvaluationEngine`.

`createOpenAICompatibleHarness(options)` / `createOpenAICompatibleHarnessFromEnv(env)` — switches the model to `JsonPlanAgentModel` when LLM credentials are available. Returns `undefined` when credentials are absent, allowing callers to fall back to the deterministic harness.

### Policy System

`RuleBasedPolicy` (`packages/core/src/policy/policy.ts`) evaluates `PolicyRule[]` in order. Each rule matches by `tool`, `name`, `actionKind`, and/or a custom `match` function, then applies `allow | deny | require_approval`. An `ApprovalGate` handles `require_approval` rules:

- `StaticApprovalGate` — always returns the same pre-configured decision.
- `InMemoryApprovalGate` — stores pending approvals keyed by request ID.

Default behavior (no matching rule) is `allow`. `AllowAllPolicy` is the no-op default.

### Memory

`HybridMemory` (`packages/core/src/memory/hybrid-memory.ts`) composes:
- `InMemoryEventMemory` — append-only trace event log.
- `SemanticMemoryStore` — keyword-based by default (`KeywordSemanticMemory`), swappable for `VectorSemanticMemory` with a `HashedEmbeddingModel` or `OpenAICompatibleEmbeddingModel`.
- Optional `KnowledgeGraphStore` (`InMemoryKnowledgeGraph`).

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

### KV-Cache and Prefix Cache (`@harnesslab/memory`)

`KvCacheSimulator` (`packages/memory/src/kvCache.ts`) simulates token-level KV-cache with configurable eviction:
- Strategies: `"lru"` (least-recently-used) or `"sliding_window"`.
- Tracks `usedBytes`, `tokenCount`, `utilization`, and `evictionCount` via `KvCacheUsage`.

`PrefixCacheSimulator` (`packages/memory/src/prefixCache.ts`) extends this with prefix-aware token sharing across requests, demonstrated in module `09_prefix_cache`.

### Learning Modules

Each module in `modules/` exports a `LearningModule`:

```ts
interface LearningModule {
  slug: string;
  title: string;
  description: string;
  failureMode: string;
  run(): Promise<LearningModuleResult>;   // result.status: "success" | "failure_demo"
}
```

Each module has a top-level `const ENABLE_HARNESS = false` (or similar) constant to toggle between broken and fixed behavior. Flip the constant to see the corrected implementation.

| Slug              | Topic                         |
|-------------------|-------------------------------|
| `01_basic_agent`  | Basic agent setup             |
| `02_loop_fix`     | Loop detection and escalation |
| `03_tools`        | Tool integration              |
| `04_guardrails`   | Policy guardrails             |
| `05_memory`       | Hybrid memory                 |
| `06_observability`| Tracing and observability     |
| `07_eval`         | Evaluation framework          |
| `08_full_agent`   | Full agent with all features  |
| `09_prefix_cache` | Prefix cache optimization     |

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
