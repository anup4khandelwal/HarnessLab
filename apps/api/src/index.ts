import { Hono } from "hono";
import { createFullAgentHarness, createOpenAICompatibleHarnessFromEnv } from "@harnesslab/core";
import { collectInference } from "@harnesslab/inference";
import { KvCacheSimulator } from "@harnesslab/memory";
import { ReplayRecorder } from "@harnesslab/replay";
import { getModuleBySlug, moduleCatalog } from "../../../src/cli/module-registry";

const app = new Hono();
const harness = createOpenAICompatibleHarnessFromEnv(Bun.env) ?? createFullAgentHarness();

app.get("/health", (context) =>
  context.json({
    name: "HarnessLab API",
    ok: true
  })
);

app.get("/modules", (context) =>
  context.json(
    moduleCatalog.map((module) => ({
      description: module.description,
      failureMode: module.failureMode,
      slug: module.slug,
      title: module.title
    }))
  )
);

app.post("/run/:slug", async (context) => {
  const selected = getModuleBySlug(context.req.param("slug"));

  if (selected === undefined) {
    return context.json(
      {
        error: "Unknown module"
      },
      404
    );
  }

  return context.json(await selected.run());
});

app.post("/agent", async (context) => {
  const body = await context.req.json().catch(() => ({}));
  const goal = typeof body.goal === "string" && body.goal.trim().length > 0 ? body.goal : "Use the harness runtime to solve 2 + 2.";

  return context.json(await harness.run({ goal }));
});

app.post("/inference/simulate", async (context) => {
  const body = await context.req.json().catch(() => ({}));
  const prompt =
    typeof body.prompt === "string" && body.prompt.trim().length > 0
      ? body.prompt
      : "Explain how prefill and decode differ.";
  const replay = new ReplayRecorder("api_inference");
  const result = await collectInference({
    generationPlan: Array.isArray(body.generationPlan)
      ? body.generationPlan.filter((item: unknown): item is string => typeof item === "string")
      : undefined,
    id: "api_request",
    kvCache: new KvCacheSimulator({
      evictionStrategy: "sliding_window",
      maxBytes: 32_768,
      windowSizeTokens: 128
    }),
    maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : 12,
    prompt,
    replayRecorder: replay,
    stopTokens: Array.isArray(body.stopTokens)
      ? body.stopTokens.filter((item: unknown): item is string => typeof item === "string")
      : undefined
  });

  return context.json({
    completion: result.completion,
    events: result.events,
    replay: replay.snapshot()
  });
});

app.get("/traces", (context) => context.json(harness.tracer.listRuns()));

if (import.meta.main) {
  const port = Number(Bun.env.PORT ?? 3001);

  Bun.serve({
    fetch: app.fetch,
    port
  });

  console.log(`HarnessLab API listening on http://localhost:${port}`);
}

export default app;
