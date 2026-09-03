import { marked, type Token, type Tokens } from "marked";

export type RichTextInline =
  | { type: "text"; text: string }
  | { type: "strong"; children: RichTextInline[] }
  | { type: "emphasis"; children: RichTextInline[] }
  | { type: "strikethrough"; children: RichTextInline[] }
  | { type: "inlineCode"; text: string }
  | { type: "link"; href: string; children: RichTextInline[] }
  | { type: "break" };

export type RichTextBlock =
  | { type: "paragraph"; children: RichTextInline[] }
  | { type: "heading"; depth: number; children: RichTextInline[] }
  | { type: "code"; text: string; language?: string }
  | { type: "blockquote"; children: RichTextBlock[] }
  | { type: "list"; ordered: boolean; start: number; items: RichTextBlock[][] }
  | { type: "table"; align: Array<"center" | "left" | "right" | null>; header: RichTextInline[][]; rows: RichTextInline[][][] }
  | { type: "thematicBreak" };

function literal(value: string): RichTextInline[] {
  return value ? [{ type: "text", text: value }] : [];
}

const MAX_RICH_TEXT_DEPTH = 32;

function parseInlines(tokens: Token[] | undefined, fallback = "", depth = 0): RichTextInline[] {
  if (!tokens?.length) return literal(fallback);
  if (depth >= MAX_RICH_TEXT_DEPTH) return literal(fallback || tokens.map((token) => token.raw).join(""));
  return tokens.flatMap((token): RichTextInline[] => {
    switch (token.type) {
      case "text": {
        const value = token as Tokens.Text;
        return value.tokens?.length ? parseInlines(value.tokens, value.text, depth + 1) : literal(value.text);
      }
      case "escape": return literal((token as Tokens.Escape).text);
      case "strong": return [{ type: "strong", children: parseInlines((token as Tokens.Strong).tokens, (token as Tokens.Strong).text, depth + 1) }];
      case "em": return [{ type: "emphasis", children: parseInlines((token as Tokens.Em).tokens, (token as Tokens.Em).text, depth + 1) }];
      case "del": return [{ type: "strikethrough", children: parseInlines((token as Tokens.Del).tokens, (token as Tokens.Del).text, depth + 1) }];
      case "codespan": return [{ type: "inlineCode", text: (token as Tokens.Codespan).text }];
      case "br": return [{ type: "break" }];
      case "link": {
        const value = token as Tokens.Link;
        return [{ type: "link", href: value.href, children: parseInlines(value.tokens, value.text, depth + 1) }];
      }
      case "image": return literal((token as Tokens.Image).text);
      case "html": return literal(token.raw);
      default: return literal("text" in token && typeof token.text === "string" ? token.text : token.raw);
    }
  });
}

function inlineParagraph(tokens: Token[], fallback: string): RichTextBlock {
  return { type: "paragraph", children: parseInlines(tokens, fallback) };
}

function parseBlocks(tokens: Token[], depth = 0): RichTextBlock[] {
  if (depth >= MAX_RICH_TEXT_DEPTH) return [{ type: "paragraph", children: literal(tokens.map((token) => token.raw).join("")) }];
  return tokens.flatMap((token): RichTextBlock[] => {
    switch (token.type) {
      case "space":
      case "def": return [];
      case "paragraph": {
        const value = token as Tokens.Paragraph;
        return [inlineParagraph(value.tokens, value.text)];
      }
      case "text": {
        const value = token as Tokens.Text;
        return [inlineParagraph(value.tokens ?? [], value.text)];
      }
      case "heading": {
        const value = token as Tokens.Heading;
        return [{ type: "heading", depth: value.depth, children: parseInlines(value.tokens, value.text) }];
      }
      case "code": {
        const value = token as Tokens.Code;
        return [{ type: "code", text: value.text, ...(value.lang ? { language: value.lang.trim().split(/\s+/)[0] } : {}) }];
      }
      case "blockquote": return [{ type: "blockquote", children: parseBlocks((token as Tokens.Blockquote).tokens, depth + 1) }];
      case "list": {
        const value = token as Tokens.List;
        return [{ type: "list", ordered: value.ordered, start: typeof value.start === "number" ? value.start : 1, items: value.items.map((item) => parseBlocks(item.tokens, depth + 1)) }];
      }
      case "table": {
        const value = token as Tokens.Table;
        return [{ type: "table", align: value.align, header: value.header.map((cell) => parseInlines(cell.tokens, cell.text)), rows: value.rows.map((row) => row.map((cell) => parseInlines(cell.tokens, cell.text))) }];
      }
      case "hr": return [{ type: "thematicBreak" }];
      case "html": return [{ type: "paragraph", children: literal(token.raw) }];
      default: return "tokens" in token && token.tokens?.length ? parseBlocks(token.tokens, depth + 1) : token.raw ? [{ type: "paragraph", children: literal(token.raw) }] : [];
    }
  });
}

export function isSafeRichTextUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseRichText(content: string): RichTextBlock[] {
  if (!content) return [];
  return parseBlocks(marked.lexer(content, { gfm: true, breaks: false, pedantic: false }));
}
