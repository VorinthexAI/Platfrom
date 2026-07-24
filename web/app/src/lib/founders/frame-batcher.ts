export interface FrameBatcher<T> {
  push: (value: T) => void;
  flush: () => void;
  cancel: () => void;
}

export function createFrameBatcher<T>(
  apply: (values: T[]) => void,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancelFrame: (handle: number) => void = cancelAnimationFrame,
): FrameBatcher<T> {
  let queued: T[] = [];
  let frame: number | null = null;

  const drain = () => {
    frame = null;
    if (queued.length === 0) return;
    const values = queued;
    queued = [];
    apply(values);
  };

  return {
    push(value) {
      queued.push(value);
      if (frame === null) frame = schedule(drain);
    },
    flush() {
      if (frame !== null) cancelFrame(frame);
      drain();
    },
    cancel() {
      if (frame !== null) cancelFrame(frame);
      frame = null;
      queued = [];
    },
  };
}
