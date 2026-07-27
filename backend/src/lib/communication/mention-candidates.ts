const normalizedMentionName = (name: string) => name.normalize('NFKC').trim().toLowerCase();

export function dedupeMentionCandidates<T extends { type: string; name: string }>(candidates: readonly T[]): T[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const lane = candidate.type === 'orchestrator' ? 'orchestrator' : 'people';
    const identity = `${lane}:${normalizedMentionName(candidate.name)}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
