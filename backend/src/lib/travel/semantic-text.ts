export function buildPlaceEmbeddingText(input: { name: string; summary: string }) {
  return `${input.name}: ${input.summary}`;
}

export const TRIP_EMBEDDING_CONTENT_VERSION = 1 as const;

export function buildTripEmbeddingText(input: { name: string; description?: string | null }) {
  return [input.name, input.description].filter((value): value is string => Boolean(value)).join('\n\n');
}
