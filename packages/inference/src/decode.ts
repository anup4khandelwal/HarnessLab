import type { DecodeResult, InferenceFinishReason, PrefillState, TokenEvent } from "./types";

export const decode = async (state: PrefillState): Promise<DecodeResult> => {
  if (state.done) {
    return {
      event: undefined,
      finishReason: state.finishReason
    };
  }

  if (state.outputTokens.length >= state.request.maxTokens) {
    state.done = true;
    state.finishReason = "max_tokens";
    state.metrics.end();

    return {
      event: undefined,
      finishReason: state.finishReason
    };
  }

  const nextToken = state.remainingPlan.shift();

  if (nextToken === undefined) {
    state.done = true;
    state.finishReason = "exhausted_plan";
    state.metrics.end();

    return {
      event: undefined,
      finishReason: state.finishReason
    };
  }

  const startedAtMs = performance.now();
  await sleep(state.request.decodeLatencyMs);

  if (state.request.stopTokens.includes(nextToken)) {
    state.done = true;
    state.finishReason = "stop_token";
    state.metrics.end();
    state.replayRecorder?.recordDecision({
      finishReason: state.finishReason,
      requestId: state.request.id,
      token: nextToken
    });

    return {
      event: undefined,
      finishReason: state.finishReason
    };
  }

  state.outputTokens.push(nextToken);
  state.request.kvCache.add({
    position: state.promptTokens.length + state.outputTokens.length - 1,
    requestId: state.request.id,
    token: nextToken
  });
  state.metrics.onToken();

  if (state.outputTokens.length >= state.request.maxTokens) {
    state.done = true;
    state.finishReason = "max_tokens";
    state.metrics.end();
  }

  const event: TokenEvent = {
    cacheUsage: state.request.kvCache.getUsage(),
    latencyMs: performance.now() - startedAtMs,
    metrics: state.metrics.snapshot(),
    outputText: state.outputTokens.join(" "),
    phase: "decode",
    requestId: state.request.id,
    token: nextToken,
    tokenIndex: state.outputTokens.length - 1,
    type: "token"
  };

  state.replayRecorder?.recordToken({
    requestId: state.request.id,
    token: nextToken,
    tokenIndex: event.tokenIndex
  });

  return {
    event,
    finishReason: state.finishReason
  };
};

export const buildCompletionEvent = (
  state: PrefillState,
  finishReason: InferenceFinishReason
) => ({
  cacheUsage: state.request.kvCache.getUsage(),
  finishReason,
  metrics: state.metrics.snapshot(),
  outputText: state.outputTokens.join(" "),
  outputTokens: [...state.outputTokens],
  phase: "decode" as const,
  requestId: state.request.id,
  type: "completed" as const
});

const sleep = async (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

