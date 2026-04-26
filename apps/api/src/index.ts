import { Hono } from "hono";
import { createFullAgentHarness, createOpenAICompatibleHarnessFromEnv } from "@harnesslab/core";
import { InferenceRuntime, type InferenceRuntimeRequestInput } from "@harnesslab/inference-runtime";
import { collectInference } from "@harnesslab/inference";
import { KvCacheSimulator, type KvCacheOptions } from "@harnesslab/memory";
import type { PricingModel } from "@harnesslab/metrics";
import { ReplayRecorder } from "@harnesslab/replay";
import { getModuleBySlug, moduleCatalog } from "../../../src/cli/module-registry";

const app = new Hono();
const harness = createOpenAICompatibleHarnessFromEnv(Bun.env) ?? createFullAgentHarness();
const inferenceRuntime = new InferenceRuntime({
  defaultKvCacheOptions: {
    evictionStrategy: "sliding_window",
    maxBytes: 32_768,
    windowSizeTokens: 128
  },
  defaultMaxTokens: 12
});

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

app.post("/inference/requests", async (context) => {
  const body = await context.req.json().catch(() => ({}));
  const request = inferenceRuntime.submit(parseInferenceRuntimeRequest(body));
  return context.json(request, 202);
});

app.get("/inference/requests/:id", (context) => {
  const request = inferenceRuntime.getRequestState(context.req.param("id"));

  if (request === undefined) {
    return context.json(
      {
        error: "Unknown inference request"
      },
      404
    );
  }

  return context.json(request);
});

app.get("/inference/requests/:id/replay", (context) => {
  const replay = inferenceRuntime.getReplay(context.req.param("id"));

  if (replay === undefined) {
    return context.json(
      {
        error: "Unknown inference request"
      },
      404
    );
  }

  return context.json(replay);
});

app.post("/inference/requests/:id/cancel", (context) => {
  const request = inferenceRuntime.cancel(context.req.param("id"));

  if (request === undefined) {
    return context.json(
      {
        error: "Unknown inference request"
      },
      404
    );
  }

  return context.json(request);
});

app.get("/inference/requests/:id/stream", (context) => {
  const requestId = context.req.param("id");
  const request = inferenceRuntime.getRequestState(requestId);

  if (request === undefined) {
    return context.json(
      {
        error: "Unknown inference request"
      },
      404
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          for await (const event of inferenceRuntime.stream(requestId)) {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          }

          controller.close();
        } catch (error) {
          controller.error(error);
        }
      })();
    }
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache",
      "content-type": "application/x-ndjson; charset=utf-8"
    }
  });
});

app.get("/inference/batches", (context) => context.json(inferenceRuntime.getBatchHistory()));

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

const parseInferenceRuntimeRequest = (body: unknown): InferenceRuntimeRequestInput => {
  const resolved = typeof body === "object" && body !== null ? body : {};
  const source = resolved as Record<string, unknown>;
  const generationPlan = asStringArray(source.generationPlan);
  const stopTokens = asStringArray(source.stopTokens);
  const kvCacheOptions =
    typeof source.kvCacheOptions === "object" && source.kvCacheOptions !== null
      ? parseKvCacheOptions(source.kvCacheOptions as Record<string, unknown>)
      : undefined;
  const pricing =
    typeof source.pricing === "object" && source.pricing !== null
      ? parsePricing(source.pricing as Record<string, unknown>)
      : undefined;

  return {
    prompt:
      typeof source.prompt === "string" && source.prompt.trim().length > 0
        ? source.prompt
        : "Explain how prefill and decode differ.",
    ...(typeof source.decodeLatencyMs === "number" ? { decodeLatencyMs: source.decodeLatencyMs } : {}),
    ...(generationPlan !== undefined ? { generationPlan } : {}),
    ...(typeof source.id === "string" && source.id.trim().length > 0 ? { id: source.id } : {}),
    ...(kvCacheOptions !== undefined ? { kvCacheOptions } : {}),
    ...(typeof source.maxTokens === "number" ? { maxTokens: source.maxTokens } : {}),
    ...(typeof source.model === "string" && source.model.trim().length > 0 ? { model: source.model } : {}),
    ...(typeof source.prefillLatencyMs === "number" ? { prefillLatencyMs: source.prefillLatencyMs } : {}),
    ...(pricing !== undefined ? { pricing } : {}),
    ...(stopTokens !== undefined ? { stopTokens } : {})
  };
};

const parseKvCacheOptions = (options: Record<string, unknown>): Partial<KvCacheOptions> => {
  const parsed: Partial<KvCacheOptions> = {};

  if (options.evictionStrategy === "lru" || options.evictionStrategy === "sliding_window") {
    parsed.evictionStrategy = options.evictionStrategy;
  }

  if (typeof options.maxBytes === "number") {
    parsed.maxBytes = options.maxBytes;
  }

  if (typeof options.tokenByteOverhead === "number") {
    parsed.tokenByteOverhead = options.tokenByteOverhead;
  }

  if (typeof options.windowSizeTokens === "number") {
    parsed.windowSizeTokens = options.windowSizeTokens;
  }

  return parsed;
};

const parsePricing = (pricing: Record<string, unknown>): Partial<PricingModel> => {
  const parsed: Partial<PricingModel> = {};

  if (typeof pricing.cachedInputCostPer1KTokens === "number") {
    parsed.cachedInputCostPer1KTokens = pricing.cachedInputCostPer1KTokens;
  }

  if (typeof pricing.inputCostPer1KTokens === "number") {
    parsed.inputCostPer1KTokens = pricing.inputCostPer1KTokens;
  }

  if (typeof pricing.outputCostPer1KTokens === "number") {
    parsed.outputCostPer1KTokens = pricing.outputCostPer1KTokens;
  }

  return parsed;
};

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
