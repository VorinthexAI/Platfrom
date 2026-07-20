import { Fragment, type ReactNode } from "react";

/**
 * Minimal sanitized Markdown renderer for streamed responses. The
 * repo has no markdown dependency, so this renders a small trusted subset —
 * headings, paragraphs, lists, blockquotes, fenced code, inline code,
 * bold/italic, and http(s) links — directly to React elements. Raw HTML is
 * never parsed or injected, so arbitrary markup cannot execute.
 */

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; language: string; code: string };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      index += 1; // closing fence (or end of stream while it is still open)
      blocks.push({ kind: "code", language: fence[1] ?? "", code: code.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length as 1 | 2 | 3, text: heading[2] ?? "" });
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quote.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", text: quote.join(" ") });
      continue;
    }
    const unordered = /^[-*]\s+/;
    const orderedPattern = /^\d+[.)]\s+/;
    if (unordered.test(line) || orderedPattern.test(line)) {
      const ordered = orderedPattern.test(line);
      const pattern = ordered ? orderedPattern : unordered;
      const items: string[] = [];
      while (index < lines.length && pattern.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(pattern, ""));
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim()
      && !/^(#{1,3})\s+/.test(lines[index] ?? "")
      && !/^```/.test(lines[index] ?? "")
      && !/^>\s?/.test(lines[index] ?? "")
      && !unordered.test(lines[index] ?? "")
      && !orderedPattern.test(lines[index] ?? "")) {
      paragraph.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

const INLINE_PATTERN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;

function renderInline(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[0.85em] text-silver-100">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key} className="font-semibold text-silver-50">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (link) {
        nodes.push(
          <a
            key={key}
            href={link[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-silver-100 underline decoration-silver-500/60 underline-offset-2 hover:decoration-silver-100"
          >
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    cursor = match.index + token.length;
    key += 1;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length === 1 ? nodes[0] : nodes.map((node, position) => <Fragment key={position}>{node}</Fragment>);
}

export function SafeMarkdown({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);
  return (
    <div className="space-y-4 text-[0.95rem] leading-relaxed text-silver-100">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const classNames = {
            1: "font-display text-xl tracking-[0.06em] text-silver-50",
            2: "font-display text-lg tracking-[0.05em] text-silver-50",
            3: "text-base font-semibold text-silver-50",
          } as const;
          const Tag = (`h${block.level + 2}`) as "h3" | "h4" | "h5";
          return <Tag key={index} className={classNames[block.level]}>{renderInline(block.text)}</Tag>;
        }
        if (block.kind === "code") {
          return (
            <pre
              key={index}
              className="overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-4 font-mono text-[0.82rem] leading-relaxed text-silver-100"
            >
              <code>{block.code}</code>
            </pre>
          );
        }
        if (block.kind === "quote") {
          return (
            <blockquote key={index} className="border-l-2 border-silver-500/40 pl-4 text-silver-300">
              {renderInline(block.text)}
            </blockquote>
          );
        }
        if (block.kind === "list") {
          const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>);
          return block.ordered
            ? <ol key={index} className="list-decimal space-y-1.5 pl-5">{items}</ol>
            : <ul key={index} className="list-disc space-y-1.5 pl-5">{items}</ul>;
        }
        return <p key={index}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}
