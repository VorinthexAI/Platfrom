export type BookProgressIntent = { progressSeconds: number; isCompleted: boolean };

export function mergeBookProgressIntent(current: BookProgressIntent, next: BookProgressIntent): BookProgressIntent {
  return {
    progressSeconds: Math.max(current.progressSeconds, next.progressSeconds),
    isCompleted: current.isCompleted || next.isCompleted,
  };
}

export class BookProgressWriter {
  private desired = new Map<string, BookProgressIntent>();
  private acknowledged = new Map<string, BookProgressIntent>();
  private running = new Map<string, { epoch: number; promise: Promise<void> }>();
  private epoch = 0;

  enqueue(key: string, intent: BookProgressIntent, write: (intent: BookProgressIntent) => Promise<void>) {
    const baseline = this.desired.get(key) ?? this.acknowledged.get(key) ?? { progressSeconds: 0, isCompleted: false };
    this.desired.set(key, mergeBookProgressIntent(baseline, intent));
    const current = this.running.get(key);
    if (current) return current.promise;
    const epoch = this.epoch;
    const promise = this.drain(key, epoch, write);
    this.running.set(key, { epoch, promise });
    return promise;
  }

  reset() {
    this.epoch += 1;
    this.desired.clear();
    this.acknowledged.clear();
    this.running.clear();
  }

  private async drain(key: string, epoch: number, write: (intent: BookProgressIntent) => Promise<void>) {
    try {
      while (true) {
        if (epoch !== this.epoch) return;
        const writing = this.desired.get(key);
        if (!writing) return;
        await write(writing);
        if (epoch !== this.epoch) return;
        this.acknowledged.set(key, mergeBookProgressIntent(this.acknowledged.get(key) ?? { progressSeconds: 0, isCompleted: false }, writing));
        const latest = this.desired.get(key);
        if (!latest) return;
        if (writing.progressSeconds === latest.progressSeconds && writing.isCompleted === latest.isCompleted) return;
      }
    } finally {
      if (this.running.get(key)?.epoch === epoch) this.running.delete(key);
    }
  }
}
