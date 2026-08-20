export function buildPlaceEmbeddingText(input: { name: string; summary: string }) {
  return `${input.name}: ${input.summary}`;
}
