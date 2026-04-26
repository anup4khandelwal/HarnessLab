import { Hono } from "hono";
import { createFullAgentHarness } from "@harnesslab/core";
import { getModuleBySlug, moduleCatalog } from "../../../src/cli/module-registry";

const app = new Hono();
const harness = createFullAgentHarness();

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

