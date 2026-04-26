# HarnessLab

HarnessLab is an open-source platform for learning and simulating how real AI systems work internally.

It is not a chatbot framework. It treats agent behavior and inference behavior as separate but connected systems:

- `Agent = Model + Harness`
- `Harness = control plane`
- `LLM = token generation system`

The project is designed to help engineers understand both sides:

- agent control planes: tools, policies, memory, tracing, approvals, evals
- inference systems: prefill, decode, KV cache, scheduling, metrics, speculative decoding, replay

## What HarnessLab Is For

HarnessLab exists to make AI systems legible.

Instead of hiding everything behind a single API call, it exposes the layers that matter in production:

- how an agent loop makes decisions
- how policies block or gate unsafe actions
- how memory and replay support debugging
- how inference latency and cost are shaped by prefill vs decode
- how cache pressure, batching, and speculative decode affect throughput

## Core Principles

1. `Agent = Model + Harness`
2. `Harness = control plane for policies, memory, tracing, evals, approvals, and cost`
3. `LLM inference = autoregressive token generation, not just a request/response wrapper`

## Stack

- Runtime: Bun
- Backend: Hono
- Language: TypeScript with strict mode
- Architecture: modular workspace packages
- UI: optional TanStack Start shell in `apps/web`

## Main Capabilities

- Production-style agent loop: `observe -> plan -> act -> verify -> repeat`
- JSON-schema tool registry and safe tool execution
- Guardrails with `allow`, `deny`, and `require_approval`
- Hybrid memory with event logs and semantic recall
- Full tracing for runs, tool calls, policy decisions, failures, and completion
- Regression-style evals for agent behavior
- Simulated inference engine with:
  - prefill vs decode separation
  - async token streaming
  - stop-token and max-token termination
  - TTFT / TPOT / throughput / cost tracking
  - KV-cache growth and eviction
  - request batching and scheduling
  - speculative decoding simulation
  - replayable token/decision traces

## Repository Layout

```text
.
├── apps
│   ├── api
│   └── web
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

## Package Guide

### `@harnesslab/core`

Agent runtime and harness primitives.

Important areas:

- `packages/core/src/agent/runtime.ts`
- `packages/core/src/policy/policy.ts`
- `packages/core/src/tooling/tool-registry.ts`
- `packages/core/src/memory/hybrid-memory.ts`
- `packages/core/src/observability/tracer.ts`
- `packages/core/src/eval/evaluator.ts`

### `@harnesslab/inference`

Inference simulation primitives.

- `prefill.ts`: prompt ingestion and cache population
- `decode.ts`: token-by-token generation
- `tokenLoop.ts`: async streaming inference loop
- `speculative.ts`: draft-token verification simulation

### `@harnesslab/metrics`

Request-level inference metrics.

- TTFT
- TPOT
- total tokens
- throughput
- estimated request cost

### `@harnesslab/memory`

Low-level inference memory simulation.

- `kvCache.ts`: token growth, usage accounting, eviction

### `@harnesslab/scheduler`

Batch scheduling simulation.

- enqueue requests
- wait for batching window
- dispatch batches

### `@harnesslab/replay`

Replayable execution traces.

- tokens
- decisions
- events
- tool calls

### `@harnesslab/evals`

Scenario-style pass/fail test engine for control-plane and inference behaviors.

## Quick Start

```bash
bun install
bun run typecheck
bun test
```

Core commands:

```bash
bun run module 01_basic_agent
bun run agent
bun run eval
bun run inference
bun run api
```

Optional UI shell:

```bash
bun run web
```

## Learning Modules

The `modules/` directory is the educational path through harness engineering.

1. `01_basic_agent`: naive agent with no real harness discipline
2. `02_loop_fix`: repeated-tool loop detection
3. `03_tools`: schema-safe tool calling
4. `04_guardrails`: blocked and approval-gated actions
5. `05_memory`: semantic recall vs missing recall
6. `06_observability`: why traces matter
7. `07_eval`: regression and assertion-based evaluation
8. `08_full_agent`: combined reference harness

Most lessons expose a small constant in the module file so the failure mode can be flipped into the fixed mode.

## Agent Runtime

The agent runtime coordinates:

- `AgentModel`: proposes the next step
- `ToolRegistry`: validates and executes tools
- `ToolPolicy`: decides whether actions are allowed
- `HybridMemory`: stores events and semantic notes
- `Tracer`: records the run
- `Verifier`: checks whether to continue or terminate
- `LoopDetector`: escalates stalled or repetitive runs

Relevant files:

- [packages/core/src/agent/runtime.ts](packages/core/src/agent/runtime.ts)
- [packages/core/src/agent/llm-model.ts](packages/core/src/agent/llm-model.ts)
- [packages/core/src/modules/demo-kit.ts](packages/core/src/modules/demo-kit.ts)

## Inference Engine

The inference side intentionally models a real serving loop:

```ts
const { event: prefillEvent, state } = await prefill(request)

while (!state.done) {
  const result = await decode(state)
  if (result.event) yield result.event
}
```

Behavior modeled:

- prefill as the slower, context-loading phase
- decode as repeated next-token emission
- stop-token termination
- max-token termination
- token streaming via async generators
- metrics and cache updates during generation

Relevant files:

- [packages/inference/src/prefill.ts](packages/inference/src/prefill.ts)
- [packages/inference/src/decode.ts](packages/inference/src/decode.ts)
- [packages/inference/src/tokenLoop.ts](packages/inference/src/tokenLoop.ts)
- [packages/inference/src/speculative.ts](packages/inference/src/speculative.ts)

## Metrics, Cache, and Scheduling

The control-plane simulator also includes operational primitives that usually stay hidden in app-level agent demos.

### Metrics

[packages/metrics/src/request-metrics.ts](packages/metrics/src/request-metrics.ts)

Tracks:

- TTFT
- TPOT
- total tokens
- total latency
- throughput
- estimated cost

### KV Cache

[packages/memory/src/kvCache.ts](packages/memory/src/kvCache.ts)

Supports:

- token-by-token memory growth
- configurable memory caps
- `lru` eviction
- `sliding_window` eviction

### Scheduler

[packages/scheduler/src/index.ts](packages/scheduler/src/index.ts)

Supports:

- request queueing
- batching windows
- bounded batch size
- batched dispatch simulation

## Replay and Evaluation

### Replay

[packages/replay/src/index.ts](packages/replay/src/index.ts)

Records:

- tokens
- decisions
- events
- tool calls

This makes simulated runs inspectable and replayable step by step.

### Evals

[packages/evals/src/index.ts](packages/evals/src/index.ts)

Supports:

- scenario definitions
- assertion-based validation
- pass/fail reporting

This is separate from the agent eval engine in `@harnesslab/core`, which focuses on harness behavior inside the agent runtime.

## Provider-Backed Agent Mode

The default runtime is deterministic so the project works without external credentials.

If you provide provider environment variables, `bun run agent` and `bun run api` switch to the LLM-backed planner automatically:

```bash
export HARNESSLAB_LLM_API_KEY=...
export HARNESSLAB_LLM_MODEL=gpt-4.1-mini

# optional
export HARNESSLAB_LLM_BASE_URL=https://api.openai.com/v1
export HARNESSLAB_EMBEDDING_MODEL=text-embedding-3-small
export HARNESSLAB_EMBEDDING_API_KEY=...
export HARNESSLAB_EMBEDDING_BASE_URL=https://api.openai.com/v1
```

Relevant constructors:

- `createOpenAICompatibleHarness(...)`
- `createOpenAICompatibleHarnessFromEnv(...)`

## API

The Hono server lives in [apps/api/src/index.ts](apps/api/src/index.ts).

Default address:

- `http://localhost:3001`

Endpoints:

- `GET /health`
- `GET /modules`
- `POST /run/:slug`
- `POST /agent`
- `POST /inference/simulate`
- `GET /traces`

Example inference simulation request:

```bash
curl -X POST http://localhost:3001/inference/simulate \
  -H 'content-type: application/json' \
  -d '{
    "prompt": "Explain prefill versus decode",
    "generationPlan": ["Prefill", "loads", "context.", "Decode", "emits", "tokens.", "<eos>"],
    "maxTokens": 12
  }'
```

Example agent request:

```bash
curl -X POST http://localhost:3001/agent \
  -H 'content-type: application/json' \
  -d '{"goal":"Use the harness runtime to solve 2 + 2."}'
```

## CLI

The CLI entrypoints live in `src/cli/`.

- `bun run agent`: run the harnessed agent
- `bun run eval`: run the core harness eval suite
- `bun run module <slug>`: run a learning module
- `bun run inference`: run the standalone inference control-plane simulator
- `bun run api`: run the Hono API

## Development Notes

- The project is strict TypeScript and intentionally keeps interfaces explicit.
- The inference engine is a simulator, not a wrapper around a hosted chat endpoint.
- The default full harness uses vector semantic memory backed by a local hashed embedding model.
- The UI is optional and not the primary teaching surface.

## Project Goal

HarnessLab is moving toward a single educational and engineering goal:

> An open-source platform to learn and simulate how real AI systems work internally, including inference, memory, cost, and control layers.
