import { collectInference } from "@harnesslab/inference";
import { KvCacheSimulator } from "@harnesslab/memory";
import { ReplayRecorder } from "@harnesslab/replay";

const prompt = Bun.argv.slice(2).join(" ").trim() || "Explain why harnesses matter for AI systems.";
const replay = new ReplayRecorder("cli_inference");
const kvCache = new KvCacheSimulator({
  evictionStrategy: "sliding_window",
  maxBytes: 16_384,
  windowSizeTokens: 64
});

const result = await collectInference({
  id: "cli_request",
  kvCache,
  maxTokens: 12,
  prompt,
  replayRecorder: replay
});

for (const event of result.events) {
  if (event.type === "token") {
    console.log(`token[${event.tokenIndex}] ${event.token}`);
  }
}

console.log(
  JSON.stringify(
    {
      cacheUsage: result.completion.cacheUsage,
      finishReason: result.completion.finishReason,
      metrics: result.completion.metrics,
      output: result.completion.outputText,
      replaySteps: replay.snapshot().steps.length
    },
    null,
    2
  )
);

