export type DocumentPassage = { id: string; text: string };
export type HighlightRange = { start: number; end: number };
export type DocumentSearchMatch = DocumentPassage & { score: number; ranges: HighlightRange[]; passageIndex: number };
export type HighlightSegment = HighlightRange & { text: string; highlighted: boolean };

type NormalizedText = { text: string; starts: number[]; ends: number[] };
type Word = { text: string; start: number; end: number };
const MAX_HIGHLIGHTS_PER_PASSAGE = 100;
const MAX_PASSAGE_MATCHES = 100;
const MAX_FUZZY_WORDS_PER_PASSAGE = 5_000;

function normalizeWithOffsets(value: string): NormalizedText {
  const text: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  let pendingSpace: { start: number; end: number } | undefined;

  for (const character of value) {
    const start = offset;
    offset += character.length;
    if (/\s/u.test(character)) {
      if (text.length) pendingSpace ??= { start, end: offset };
      else pendingSpace = undefined;
      continue;
    }
    const normalized = character.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
    if (!normalized) continue;
    if (pendingSpace) {
      text.push(" ");
      starts.push(pendingSpace.start);
      ends.push(pendingSpace.end);
      pendingSpace = undefined;
    }
    for (const normalizedCharacter of normalized) {
      text.push(normalizedCharacter);
      starts.push(start);
      ends.push(offset);
    }
  }
  return { text: text.join(""), starts, ends };
}

export function normalizeDocumentSearchText(value: string): string {
  return normalizeWithOffsets(value).text;
}

export function mergeHighlightRanges(ranges: HighlightRange[]): HighlightRange[] {
  const sorted = ranges.filter(({ start, end }) => start >= 0 && end > start).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: HighlightRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start < previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function highlightedSegments(text: string, ranges: HighlightRange[]): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let offset = 0;
  for (const range of mergeHighlightRanges(ranges).map(({ start, end }) => ({ start: Math.min(text.length, start), end: Math.min(text.length, end) }))) {
    if (range.start > offset) segments.push({ start: offset, end: range.start, text: text.slice(offset, range.start), highlighted: false });
    if (range.end > offset) segments.push({ ...range, start: Math.max(offset, range.start), text: text.slice(Math.max(offset, range.start), range.end), highlighted: true });
    offset = Math.max(offset, range.end);
  }
  if (offset < text.length) segments.push({ start: offset, end: text.length, text: text.slice(offset), highlighted: false });
  return segments;
}

function words(value: string): Word[] {
  return Array.from(value.matchAll(/[\p{L}\p{N}]+/gu), (match) => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]!;
      previous[rightIndex] = Math.min(above + 1, previous[rightIndex - 1]! + 1, diagonal! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length]!;
}

function wordScore(query: string, candidate: string): number {
  if (query === candidate) return 0.9;
  if (query.length >= 4 && candidate.startsWith(query) && query.length / candidate.length >= 0.65) return 0.72;
  if (query.length < 4 || candidate.length < 4 || Math.abs(query.length - candidate.length) > 2) return 0;
  const distance = editDistance(query, candidate);
  const allowed = Math.max(query.length, candidate.length) >= 7 ? 2 : 1;
  return distance <= allowed ? (1 - distance / Math.max(query.length, candidate.length)) * 0.85 : 0;
}

function originalRange(normalized: NormalizedText, start: number, end: number): HighlightRange | undefined {
  const originalStart = normalized.starts[start];
  const originalEnd = normalized.ends[end - 1];
  return originalStart === undefined || originalEnd === undefined ? undefined : { start: originalStart, end: originalEnd };
}

export function searchDocumentPassages(passages: DocumentPassage[], query: string, threshold = 0.55): DocumentSearchMatch[] {
  const normalizedQuery = normalizeDocumentSearchText(query);
  if (!normalizedQuery) return [];
  const queryWords = words(normalizedQuery).slice(0, 20);

  return passages.flatMap((passage, passageIndex) => {
    const normalized = normalizeWithOffsets(passage.text);
    const ranges: HighlightRange[] = [];
    let score = 0;
    let phraseIndex = normalized.text.indexOf(normalizedQuery);
    if (phraseIndex >= 0) {
      score = 1;
      while (phraseIndex >= 0 && ranges.length < MAX_HIGHLIGHTS_PER_PASSAGE) {
        const range = originalRange(normalized, phraseIndex, phraseIndex + normalizedQuery.length);
        if (range) ranges.push(range);
        phraseIndex = normalized.text.indexOf(normalizedQuery, phraseIndex + 1);
      }
    } else if (queryWords.length) {
      const passageWords = words(normalized.text).slice(0, MAX_FUZZY_WORDS_PER_PASSAGE);
      let total = 0;
      let matched = 0;
      for (const queryWord of queryWords) {
        let best = 0;
        const candidates: Word[] = [];
        for (const passageWord of passageWords) {
          const candidateScore = wordScore(queryWord.text, passageWord.text);
          if (candidateScore > best) {
            best = candidateScore;
            candidates.length = 0;
            candidates.push(passageWord);
          } else if (candidateScore === best && candidateScore > 0) candidates.push(passageWord);
        }
        total += best;
        if (best > 0) {
          matched += 1;
          for (const candidate of candidates) {
            const range = originalRange(normalized, candidate.start, candidate.end);
            if (range && ranges.length < MAX_HIGHLIGHTS_PER_PASSAGE) ranges.push(range);
          }
        }
      }
      score = (total / queryWords.length) * (matched / queryWords.length);
    }
    return score >= threshold ? [{ ...passage, passageIndex, score, ranges: mergeHighlightRanges(ranges) }] : [];
  }).sort((left, right) => right.score - left.score || left.passageIndex - right.passageIndex).slice(0, MAX_PASSAGE_MATCHES);
}
