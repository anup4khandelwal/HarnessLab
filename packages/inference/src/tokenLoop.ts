import { buildCompletionEvent, decode } from "./decode";
import { prefill } from "./prefill";
import type { InferenceEvent, InferenceRequest, InferenceRunResult } from "./types";

export async function* runInference(request: InferenceRequest): AsyncGenerator<InferenceEvent> {
  const { event: prefillEvent, state } = await prefill(request);
  yield prefillEvent;

  while (!state.done) {
    const result = await decode(state);

    if (result.event !== undefined) {
      yield result.event;
    }
  }

  const finishReason = state.finishReason ?? "exhausted_plan";
  const completion = buildCompletionEvent(state, finishReason);
  state.replayRecorder?.recordDecision({
    finishReason,
    outputTokens: completion.outputTokens.length,
    requestId: state.request.id
  });
  state.replayRecorder?.finish();
  yield completion;
}

export const collectInference = async (request: InferenceRequest): Promise<InferenceRunResult> => {
  const events: InferenceEvent[] = [];

  for await (const event of runInference(request)) {
    events.push(event);
  }

  const completion = [...events].reverse().find((event) => event.type === "completed");

  if (completion === undefined || completion.type !== "completed") {
    throw new Error("Inference run completed without a completion event");
  }

  return {
    completion,
    events
  };
};

export async function* streamTokens(request: InferenceRequest): AsyncGenerator<string> {
  for await (const event of runInference(request)) {
    if (event.type === "token") {
      yield event.token;
    }
  }
}
