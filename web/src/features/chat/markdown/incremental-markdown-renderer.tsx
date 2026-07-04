"use client";

// neural-map.md §7.5, §17.2 — renders the raw/plain-text token stream
// immediately, and only promotes a code fence to a syntax-highlighted block
// once its closing ``` has arrived (or the message itself is done, as a
// defensive fallback for a stream that ends mid-fence). Highlighting a still
// -open fence character-by-character would both waste CPU and visually
// flicker as the highlighter's best-guess state changes token to token.
import { Fragment, memo, useEffect, useMemo, useState } from "react";
import { splitIntoSegments, tokenizeInline } from "./incremental-markdown";
import { highlightCode } from "./highlight-client";
import type { HighlightToken } from "./workers/highlight.worker";

export type IncrementalMarkdownRendererProps = {
  /** Full accumulated text so far, not just the latest delta. */
  textDelta: string;
  /** False while still streaming — gates fence highlighting per §7.5. */
  isComplete: boolean;
};

function InlineText({ text }: { text: string }) {
  const tokens = useMemo(() => tokenizeInline(text), [text]);
  return (
    <>
      {tokens.map((token, index) => {
        switch (token.type) {
          case "bold":
            return <strong key={index}>{token.content}</strong>;
          case "italic":
            return <em key={index}>{token.content}</em>;
          case "code":
            return (
              <code key={index} className="rounded bg-[var(--vx-console-surface-raised)] px-1 py-0.5 text-[0.9em]">
                {token.content}
              </code>
            );
          case "link":
            return (
              <a
                key={index}
                href={token.href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[var(--vx-console-accent)] underline underline-offset-2"
              >
                {token.content}
              </a>
            );
          default:
            return <Fragment key={index}>{token.content}</Fragment>;
        }
      })}
    </>
  );
}

function CodeFence({ code, lang, shouldHighlight }: { code: string; lang: string | null; shouldHighlight: boolean }) {
  const [highlighted, setHighlighted] = useState<HighlightToken[][] | null>(null);

  useEffect(() => {
    if (!shouldHighlight) return;
    let cancelled = false;
    highlightCode(code, lang)
      .then((lines) => {
        if (!cancelled) setHighlighted(lines);
      })
      .catch(() => {
        // Worker failed — fall back to the plain, unhighlighted rendering
        // below rather than surfacing an error for a cosmetic feature.
      });
    return () => {
      cancelled = true;
    };
    // `code`/`lang` are only expected to change once shouldHighlight flips
    // from false -> true (a fence closes exactly once), so this effect fires
    // once per fence in practice, exactly matching §7.5's "highlight exactly
    // once" rule.
  }, [shouldHighlight, code, lang]);

  return (
    <pre className="my-2 overflow-x-auto rounded-lg bg-[var(--vx-console-surface)] p-3 font-mono text-[0.85em] leading-relaxed text-[var(--vx-console-text)]">
      <code>
        {highlighted
          ? highlighted.map((line, lineIndex) => (
              <div key={lineIndex}>
                {line.length === 0 ? (
                  " "
                ) : (
                  line.map((token, tokenIndex) => (
                    <span key={tokenIndex} style={token.color ? { color: token.color } : undefined}>
                      {token.content}
                    </span>
                  ))
                )}
              </div>
            ))
          : code}
      </code>
    </pre>
  );
}

function IncrementalMarkdownRendererImpl({ textDelta, isComplete }: IncrementalMarkdownRendererProps) {
  const segments = useMemo(() => splitIntoSegments(textDelta), [textDelta]);

  return (
    <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <InlineText key={index} text={segment.content} />;
        }
        return (
          <CodeFence
            key={index}
            code={segment.code}
            lang={segment.lang}
            shouldHighlight={segment.closed || isComplete}
          />
        );
      })}
    </div>
  );
}

export const IncrementalMarkdownRenderer = memo(IncrementalMarkdownRendererImpl);
