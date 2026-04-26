# HarnessLab

HarnessLab is an educational runtime for AI Harness Engineering.

The project is built around a simple idea:

> Agent = Model + Harness

Instead of treating the model as the whole agent, HarnessLab teaches the layers around it: the loop, tools, guardrails, memory, observability, loop detection, hooks, and evaluation.

## Stack

- Runtime: Bun
- Backend: Hono
- Language: TypeScript with strict mode
- Frontend: TanStack Start shell in `apps/web`

## What It Includes

- A production-style agent loop: `observe -> plan -> act -> verify -> repeat`
- Step limits, token budgets, and explicit termination conditions
- JSON-schema tool registry with safe execution wrappers
- Guardrails and approval gates
- Hybrid memory with event memory, semantic memory, and an optional knowledge graph interface
- Full tracing for steps, tool calls, failures, and completion
- Loop detection for repeated tool calls and no-progress runs
- An evaluation engine for repeatable regression testing
- Lifecycle hooks around tool execution and completion
- Eight runnable learning modules that intentionally fail until the harness is improved

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
│   └── core
│       └── src
│           ├── agent
│           ├── eval
│           ├── memory
│           ├── modules
│           ├── observability
│           ├── policy
│           └── tooling
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

## API

The Hono server lives in [apps/api/src/index.ts](apps/api/src/index.ts).

Endpoints:

- `GET /health`
- `GET /modules`
- `POST /run/:slug`
- `POST /agent`
- `GET /traces`

## Notes

- The runtime is deterministic by default so the project works without external model providers.
- The semantic memory implementation is intentionally lightweight and replaceable; swap it with a real vector store when you want embeddings.
- The optional UI is a thin TanStack Start shell over the API, not the primary teaching surface.
