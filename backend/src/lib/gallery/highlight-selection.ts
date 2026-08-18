import type { Image } from '@/lib/db/images.node';

export interface HighlightCandidate {
  image: Image;
  qualityScore: number;
}

const TARGET_WEIGHTS = [1, 1, 1, 4, 5, 6] as const;

export function highlightTargetCount(available: number, random: () => number = Math.random): number {
  if (available <= 0) return 0;
  if (available < 5) return available;
  const draw = Math.min(Math.max(random(), 0), 0.999999999) * TARGET_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  let cumulative = 0;
  for (let index = 0; index < TARGET_WEIGHTS.length; index += 1) {
    cumulative += TARGET_WEIGHTS[index]!;
    if (draw < cumulative) return Math.min(5 + index, available);
  }
  return Math.min(10, available);
}

function cosineSimilarity(left: readonly number[], right: readonly number[]) {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0, leftMagnitude = 0, rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftMagnitude += left[index]! ** 2;
    rightMagnitude += right[index]! ** 2;
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}

export function selectHighlightCandidates(candidates: readonly HighlightCandidate[], random: () => number = Math.random): HighlightCandidate[] {
  const target = highlightTargetCount(candidates.length, random);
  if (target === candidates.length) return [...candidates];
  const remaining = [...candidates];
  const selected: HighlightCandidate[] = [];
  while (selected.length < target) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]!;
      const quality = Math.min(Math.max(candidate.qualityScore, 1), 100) / 100;
      const diversity = selected.length === 0 ? 1 : Math.min(...selected.map(({ image }) => 1 - cosineSimilarity(candidate.image.embedding, image.embedding)));
      const score = random() * 0.55 + quality * 0.25 + Math.max(0, diversity) * 0.2;
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]!);
  }
  return selected;
}
