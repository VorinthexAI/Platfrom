export type TranscriptPhrase = {
  text: string;
  startRatio: number;
  endRatio: number;
};

export function buildTranscriptPhrases(content: string): TranscriptPhrase[] {
  const sentences = content
    .split(/(?<=[.!?])\s+|\n+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((sentence) => {
      if (sentence.length <= 180) return [sentence];
      return sentence
        .split(/(?<=[,;:])\s+/)
        .map((value) => value.trim())
        .filter(Boolean);
    });
  const total = Math.max(
    1,
    sentences.reduce((sum, sentence) => sum + sentence.length, 0),
  );
  let consumed = 0;
  return sentences.map((text) => {
    const startRatio = consumed / total;
    consumed += text.length;
    return { text, startRatio, endRatio: consumed / total };
  });
}

export function activeTranscriptPhrase(
  phrases: TranscriptPhrase[],
  progress: number,
) {
  if (!phrases.length) return -1;
  const normalized = Math.min(1, Math.max(0, progress));
  const index = phrases.findIndex(({ endRatio }) => normalized < endRatio);
  return index === -1 ? phrases.length - 1 : index;
}
