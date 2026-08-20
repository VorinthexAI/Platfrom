export interface ImageEmbeddingSource {
  filename: string;
  caption: string;
  city?: string | null;
  country?: string | null;
  countryCode?: string | null;
  placeName?: string | null;
  placeSummary?: string | null;
}

export function buildImageEmbeddingText(source: ImageEmbeddingSource) {
  return [
    source.filename,
    source.caption,
    source.placeName ? `Place: ${source.placeName}` : undefined,
    source.placeSummary ? `Place summary: ${source.placeSummary}` : undefined,
    source.country ? `Country: ${source.country}` : undefined,
    source.city ? `City: ${source.city}` : undefined,
    source.countryCode ? `Country code: ${source.countryCode}` : undefined,
  ].filter(Boolean).join('\n\n');
}
