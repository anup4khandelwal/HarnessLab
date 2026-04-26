import type { InferenceFinishReason } from "./types";

export interface SpeculativeDecodeRequest {
  canonicalTokens: string[];
  draftLatencyMs?: number;
  draftTokens?: string[];
  stopTokens?: string[];
  verificationLatencyMs?: number;
  verifyWindow?: number;
}

export interface SpeculativeDecodeStep {
  acceptedTokens: string[];
  canonicalToken: string | undefined;
  draftTokens: string[];
  rejectedTokens: string[];
  stepIndex: number;
}

export interface SpeculativeDecodeResult {
  acceptanceRate: number;
  acceptedTokens: number;
  draftTokens: number;
  emittedTokens: string[];
  finishReason: InferenceFinishReason;
  rejectedTokens: number;
  steps: SpeculativeDecodeStep[];
}

export const runSpeculativeDecode = async (
  request: SpeculativeDecodeRequest
): Promise<SpeculativeDecodeResult> => {
  const canonicalTokens = [...request.canonicalTokens];
  const draftTokens = [...(request.draftTokens ?? request.canonicalTokens)];
  const verifyWindow = request.verifyWindow ?? 3;
  const stopTokens = request.stopTokens ?? ["<eos>"];
  const emittedTokens: string[] = [];
  const steps: SpeculativeDecodeStep[] = [];
  let acceptedTokens = 0;
  let rejectedTokens = 0;
  let pointer = 0;

  while (pointer < canonicalTokens.length) {
    const draftChunk = draftTokens.slice(pointer, pointer + verifyWindow);
    const canonicalChunk = canonicalTokens.slice(pointer, pointer + verifyWindow);
    await sleep(request.draftLatencyMs ?? 1);
    await sleep(request.verificationLatencyMs ?? 2);

    const acceptedChunk: string[] = [];
    const rejectedChunk: string[] = [];
    let mismatchHandled = false;

    for (let index = 0; index < canonicalChunk.length; index += 1) {
      const expected = canonicalChunk[index];
      const drafted = draftChunk[index];

      if (expected === undefined) {
        break;
      }

      if (!mismatchHandled && drafted === expected && !stopTokens.includes(expected)) {
        acceptedChunk.push(expected);
        emittedTokens.push(expected);
        acceptedTokens += 1;
        pointer += 1;
        continue;
      }

      if (stopTokens.includes(expected)) {
        pointer = canonicalTokens.length;
        mismatchHandled = true;
        break;
      }

      rejectedChunk.push(drafted ?? "<missing>");
      emittedTokens.push(expected);
      rejectedTokens += drafted === undefined ? 0 : 1;
      pointer += 1;
      mismatchHandled = true;
      break;
    }

    steps.push({
      acceptedTokens: acceptedChunk,
      canonicalToken: canonicalChunk[0],
      draftTokens: draftChunk,
      rejectedTokens: rejectedChunk,
      stepIndex: steps.length
    });

    if (!mismatchHandled && draftChunk.length === 0) {
      break;
    }
  }

  const totalDraftTokens = draftTokens.length;

  return {
    acceptanceRate: totalDraftTokens === 0 ? 1 : acceptedTokens / totalDraftTokens,
    acceptedTokens,
    draftTokens: totalDraftTokens,
    emittedTokens,
    finishReason: "exhausted_plan",
    rejectedTokens,
    steps
  };
};

const sleep = async (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

