import { CanceledError } from "axios";

let epoch = 0;
let ending = false;
let controller = new AbortController();

export const sessionEpoch = () => epoch;
export const sessionIsEnding = () => ending;
export const sessionIsCurrent = (owner: number) => owner === epoch && !ending;

export function endSessionRequests() {
  ending = true;
  epoch += 1;
  controller.abort();
  controller = new AbortController();
}

export function resumeSessionRequests() {
  epoch += 1;
  controller.abort();
  controller = new AbortController();
  ending = false;
}

export function captureSessionRequest(external?: AbortSignal) {
  const owner = epoch;
  const sessionSignal = controller.signal;
  const request = new AbortController();
  const abort = () => request.abort();
  sessionSignal.addEventListener("abort", abort, { once: true });
  external?.addEventListener("abort", abort, { once: true });
  if (sessionSignal.aborted || external?.aborted) abort();
  return {
    owner,
    signal: request.signal,
    assertCurrent() { if (owner !== epoch || request.signal.aborted) throw new CanceledError("canceled"); },
    cleanup() { sessionSignal.removeEventListener("abort", abort); external?.removeEventListener("abort", abort); },
  };
}
