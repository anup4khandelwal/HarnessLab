import { InferenceRuntime } from "@harnesslab/inference-runtime";

const prompt = Bun.argv.slice(2).join(" ").trim() || "Explain why harnesses matter for AI systems.";
const runtime = new InferenceRuntime({
  defaultKvCacheOptions: {
    evictionStrategy: "sliding_window",
    maxBytes: 16_384,
    windowSizeTokens: 64
  },
  defaultMaxTokens: 12
});
const request = runtime.submit({
  prompt
});

for await (const event of runtime.stream(request.id)) {
  switch (event.type) {
    case "request_batched":
      console.log(`batch ${event.batchId} size=${event.batchSize}`);
      break;
    case "request_started":
      console.log(`started queue=${event.queueTimeMs.toFixed(2)}ms`);
      break;
    case "prefill":
      console.log(`prefill latency=${event.latencyMs.toFixed(2)}ms`);
      break;
    case "token":
      console.log(`token[${event.tokenIndex}] ${event.token}`);
      break;
    case "request_cancelled":
      console.log(`cancelled during ${event.stage}`);
      break;
    case "request_failed":
      console.log(`failed: ${event.error}`);
      break;
    default:
      break;
  }
}

const state = runtime.getRequestState(request.id);
const replay = runtime.getReplay(request.id);

console.log(
  JSON.stringify(
    {
      cacheUsage: state?.cacheUsage,
      finishReason: state?.finishReason,
      metrics: state?.metrics,
      output: state?.outputText,
      replaySteps: replay?.trace.steps.length ?? 0,
      status: state?.status
    },
    null,
    2
  )
);
