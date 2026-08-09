export type TextRange = { start: number; end: number };

export function resolveEnhancementTarget(content: string, selection: TextRange) {
  const selected = Number.isInteger(selection.start)
    && Number.isInteger(selection.end)
    && selection.start >= 0
    && selection.start < selection.end
    && selection.end <= content.length;
  return selected
    ? { content: content.slice(selection.start, selection.end), range: selection }
    : { content, range: undefined };
}

export function applyEnhancement(content: string, enhanced: string, range?: TextRange) {
  return range
    ? `${content.slice(0, range.start)}${enhanced}${content.slice(range.end)}`
    : enhanced;
}
