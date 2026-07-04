// neural-map.md §7.5 — pure data-only parsing (no JSX; the React rendering
// lives in `incremental-markdown-renderer.tsx`). Two passes:
//
//  1. `splitIntoSegments` walks the *full accumulated* text (not just the
//     latest delta — cheap enough at chat-message lengths, and much simpler
//     than tracking parse state across deltas) into alternating plain-text
//     and fenced-code segments. A fence segment's `closed` flag is exactly
//     the "closing ``` has arrived" gate the renderer uses to decide whether
//     it's safe to hand the block to the syntax highlighter yet.
//  2. `tokenizeInline` does a cheap, safe-to-rerun-per-token pass over a
//     plain-text segment for the small set of inline markers Claude.ai/most
//     chat UIs support live: bold, italic, inline code, links. This is
//     deliberately not a full markdown parser — headings/lists/tables etc.
//     are out of scope per §7.5.

export type MarkdownSegment =
  | { type: "text"; content: string }
  | { type: "fence"; lang: string | null; code: string; closed: boolean };

export function splitIntoSegments(fullText: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let cursor = 0;

  while (cursor < fullText.length) {
    const fenceStart = fullText.indexOf("```", cursor);
    if (fenceStart === -1) {
      segments.push({ type: "text", content: fullText.slice(cursor) });
      break;
    }
    if (fenceStart > cursor) {
      segments.push({ type: "text", content: fullText.slice(cursor, fenceStart) });
    }

    const afterMarker = fenceStart + 3;
    const newlineIndex = fullText.indexOf("\n", afterMarker);
    const langLine = newlineIndex === -1 ? fullText.slice(afterMarker) : fullText.slice(afterMarker, newlineIndex);
    const lang = langLine.trim() || null;
    const codeStart = newlineIndex === -1 ? fullText.length : newlineIndex + 1;
    const closeIndex = fullText.indexOf("```", codeStart);

    if (closeIndex === -1) {
      // Fence still open — everything remaining renders as raw, unhighlighted
      // monospace text until the closing ``` arrives (§7.5's core rule).
      segments.push({ type: "fence", lang, code: fullText.slice(codeStart), closed: false });
      cursor = fullText.length;
    } else {
      segments.push({ type: "fence", lang, code: fullText.slice(codeStart, closeIndex), closed: true });
      cursor = closeIndex + 3;
    }
  }

  return segments;
}

export type InlineToken =
  | { type: "text"; content: string }
  | { type: "bold"; content: string }
  | { type: "italic"; content: string }
  | { type: "code"; content: string }
  | { type: "link"; content: string; href: string };

// Order matters: `**bold**` must be attempted before single-`*` italic so
// that at a `**` boundary the bold alternative wins (JS regex alternation
// tries alternatives left-to-right at a given start position).
const INLINE_PATTERN =
  /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*]+)\*|_([^_]+)_/g;

export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  INLINE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    const [, bold, code, linkText, linkHref, italicStar, italicUnderscore] = match;
    if (bold !== undefined) tokens.push({ type: "bold", content: bold });
    else if (code !== undefined) tokens.push({ type: "code", content: code });
    else if (linkText !== undefined) tokens.push({ type: "link", content: linkText, href: linkHref });
    else if (italicStar !== undefined) tokens.push({ type: "italic", content: italicStar });
    else if (italicUnderscore !== undefined) tokens.push({ type: "italic", content: italicUnderscore });

    lastIndex = INLINE_PATTERN.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", content: text.slice(lastIndex) });
  }

  return tokens;
}
