const namedEntities: Record<string, string> = {
  amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return namedEntities[code.toLowerCase()] ?? entity;
    const numeric = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(numeric) && numeric > 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : entity;
  });
}

/** Recovers plain text from the legacy HTML field during the destructive data migration. */
export function htmlToPlainText(input: string): string {
  return decodeHtmlEntities(input
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<img\b[^>]*\balt\s*=\s*(["'])(.*?)\1[^>]*>/gi, '$2\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:td|th)>/gi, '\t')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/(?:address|article|aside|blockquote|div|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|ul)>/gi, '\n\n')
    .replace(/<\/?[a-z][^>]*>/gi, ''))
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
