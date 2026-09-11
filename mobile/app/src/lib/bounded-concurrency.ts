export async function mapWithConcurrency<T, R>(values: readonly T[], concurrency: number, operation: (value: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Concurrency must be a positive integer.");
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await operation(values[index]!, index);
    }
  });
  const settled = await Promise.allSettled(workers);
  const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
  return results;
}
