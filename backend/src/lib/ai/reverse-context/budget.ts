import { z } from 'zod';

export class KnowledgeBudgetManager {
  readonly limitTokens: number;
  constructor(limitTokens: number) {
    this.limitTokens = z.number().int().min(64).max(200_000).parse(limitTokens);
  }
  estimate(value: unknown) { return Math.ceil(JSON.stringify(value).length / 4); }
  fits(value: unknown) { return this.estimate(value) <= this.limitTokens; }
  dropLowestUntilFit<T>(rankedValues: readonly T[]) {
    const values = [...rankedValues];
    let dropped = 0;
    while (!this.fits(values) && values.length > 0) { values.pop(); dropped += 1; }
    return { values, dropped, estimatedTokens: this.estimate(values) };
  }
}
