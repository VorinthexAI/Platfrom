import { z } from 'zod';

export const embedInputSchema = z.object({ text: z.string() });

/** Deterministic local embedding used until a provider-backed embedder is wired in. */
export async function embed(input: z.infer<typeof embedInputSchema>) {
  const parsed = embedInputSchema.parse(input);
  const vector = Array.from({ length: 1536 }, () => 0);
  const words = parsed.text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const word of words) {
    addFeature(vector, `word:${word}`, 2);
    const padded = `^${word}$`;
    for (let index = 0; index <= padded.length - 3; index += 1) addFeature(vector, `tri:${padded.slice(index, index + 3)}`, 0.25);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

function addFeature(vector: number[], feature: string, weight: number) {
  let hash = 2_166_136_261;
  for (const character of feature) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  const index = (hash >>> 0) % vector.length;
  vector[index] = (vector[index] ?? 0) + ((hash & 1) === 0 ? weight : -weight);
}
