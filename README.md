# HarnessLab

HarnessLab is an open-source learning and simulation platform for AI Harness Engineering and LLM inference systems.

The project is built around a simple idea:

> Agent = Model + Harness

Instead of treating the model as the whole agent, HarnessLab teaches the layers around it: the loop, tools, guardrails, memory, observability, loop detection, hooks, evaluation, and now the inference control plane itself.

## Stack

- Runtime: Bun
- Backend: Hono
- Language: TypeScript with strict mode
- Frontend: TanStack Start shell in `apps/web`

## What It Includes

- A production-style agent loop: `observe -> plan -> act -> verify -> repeat`
- Step limits, token budgets, and explicit termination conditions
- JSON-schema tool registry with safe execution wrappers
- Guardrails, structured approval gates, and approval records
- Hybrid memory with event memory, keyword or vector semantic memory, and an optional knowledge graph interface
- Full tracing for steps, tool calls, failures, and completion
- Loop detection for repeated tool calls and no-progress runs
- Assertion-based evaluation for repeatable regression testing
- Lifecycle hooks around tool execution and completion
- Eight runnable learning modules that intentionally fail until the harness is improved
- Optional real LLM and embedding adapters for OpenAI-compatible providers
- Simulated inference internals: prefill, decode, KV cache, batching, speculative decoding, replay, and request-level metrics

## Folder Structure

```text
.
├── apps
│   ├── api
│   │   └── src/index.ts
│   └── web
│       ├── package.json
│       ├── src/router.tsx
│       ├── src/routes/__root.tsx
│       └── src/routes/index.tsx
├── modules
│   ├── 01_basic_agent
│   ├── 02_loop_fix
│   ├── 03_tools
│   ├── 04_guardrails
│   ├── 05_memory
│   ├── 06_observability
│   ├── 07_eval
│   └── 08_full_agent
├── packages
│   ├── core
│   ├── evals
│   ├── inference
│   ├── memory
│   ├── metrics
│   ├── replay
│   └── scheduler
├── src
│   └── cli
└── tests
```

## Quick Start

```bash
bun install
bun run typecheck
bun test
```

Run the core commands:

```bash
bun run module 01_basic_agent
bun run agent
bun run eval
bun run inference
bun run api
```

The API starts on `http://localhost:3001`.

If you want the optional UI shell:

```bash
bun run web
```

## Learning Modules

Each module is intentionally small and focused:

1. `01_basic_agent`: a naive agent that reflects forever
2. `02_loop_fix`: repeated tool calls trigger loop escalation
3. `03_tools`: bad tool input fails schema validation
4. `04_guardrails`: unsafe actions are denied by policy
5. `05_memory`: event logs exist, but semantic recall is broken
6. `06_observability`: the agent works but leaves no trace
7. `07_eval`: regressions are caught by the evaluation suite
8. `08_full_agent`: the reference harness with all layers enabled

Most modules expose a single constant flag in their `index.ts` file. Flip the flag, rerun the module, and compare the before/after trace.

## Core Runtime

The runtime lives in [packages/core/src/agent/runtime.ts](packages/core/src/agent/runtime.ts) and coordinates:

- `AgentModel`: produces the next plan from the current observation
- `ToolRegistry`: validates and executes tool calls
- `ToolPolicy`: blocks, allows, or gates sensitive actions
- `HybridMemory`: stores events and enables semantic recall
- `Tracer`: records everything needed for debugging and evaluation
- `Verifier`: decides whether the loop should continue or terminate
- `LoopDetector`: escalates repeated or stagnant runs

Recent extension points:

- `JsonPlanAgentModel`: provider-backed planner that asks an LLM for the next harness action
- `OpenAICompatibleClient`: chat-completions adapter for real model calls
- `OpenAICompatibleEmbeddingModel`: embedding adapter for vector memory
- `VectorSemanticMemory`: cosine-similarity search over embedded notes and events
- `InMemoryApprovalGate`: records approval requests and supports pending, approved, or denied outcomes
- richer `EvaluationEngine` assertions for status, output, tool use, steps, token usage, and trace volume

## Inference Control Plane

HarnessLab now models the inference side of AI systems as first-class packages:

- `@harnesslab/inference`: prefill, decode, token loop, and speculative decoding
- `@harnesslab/metrics`: TTFT, TPOT, throughput, token counts, and request cost
- `@harnesslab/memory`: KV-cache growth and eviction simulation
- `@harnesslab/scheduler`: queued batching and batch dispatch
- `@harnesslab/replay`: token, tool, and decision replay traces
- `@harnesslab/evals`: scenario-style pass/fail test engine

Key files:

- `packages/inference/src/prefill.ts`
- `packages/inference/src/decode.ts`
- `packages/inference/src/tokenLoop.ts`
- `packages/inference/src/speculative.ts`
- `packages/metrics/src/request-metrics.ts`
- `packages/memory/src/kvCache.ts`
- `packages/scheduler/src/index.ts`

The inference simulator is intentionally not a chatbot wrapper. It models:

- slow prefill vs fast decode
- asynchronous token streaming
- stop-token and max-token termination
- request metrics and cost accounting
- KV-cache growth and eviction
- batch scheduling windows
- speculative decoding acceptance rates
- replayable execution steps

## Real Provider Mode

`bun run agent` and `bun run api` still work deterministically by default.

If you set provider environment variables, they switch to the LLM-backed harness automatically:

```bash
export HARNESSLAB_LLM_API_KEY=...
export HARNESSLAB_LLM_MODEL=gpt-4.1-mini

# optional
export HARNESSLAB_LLM_BASE_URL=https://api.openai.com/v1
export HARNESSLAB_EMBEDDING_MODEL=text-embedding-3-small
export HARNESSLAB_EMBEDDING_API_KEY=...
export HARNESSLAB_EMBEDDING_BASE_URL=https://api.openai.com/v1
```

The provider-backed harness is created through:

- `createOpenAICompatibleHarness(...)`
- `createOpenAICompatibleHarnessFromEnv(...)`

## API

The Hono server lives in [apps/api/src/index.ts](apps/api/src/index.ts).

Endpoints:

- `GET /health`
- `GET /modules`
- `POST /run/:slug`
- `POST /agent`
- `POST /inference/simulate`
- `GET /traces`

## Notes

- The runtime is deterministic by default so the project works without external model providers.
- The default full harness now uses vector semantic memory backed by a local hashed embedding model, and can swap to remote embeddings when configured.
- `bun run inference` exercises the standalone inference control-plane simulation from the CLI.
- The optional UI is a thin TanStack Start shell over the API, not the primary teaching surface.
