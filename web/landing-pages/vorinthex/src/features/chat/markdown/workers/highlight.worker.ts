/// <reference lib="webworker" />

// neural-map.md §7.5.1 — runs Shiki off the main thread so highlighting a
// large/complex code block never blocks composer input handling while a
// previous message's code block finishes streaming. Returns a plain,
// structurally-cloneable token array (content/color/fontStyle per token,
// grouped by line) — never HTML. The main thread renders that array via
// trusted React `<span>` elements, never `dangerouslySetInnerHTML`, as
// defense-in-depth even though this worker is our own first-party code.
import { createHighlighter, type BundledLanguage, type Highlighter } from "shiki";

export type HighlightWorkerRequest = {
  type: "highlight";
  requestId: string;
  code: string;
  lang: string | null;
};

export type HighlightToken = {
  content: string;
  color?: string;
  fontStyle?: number;
};

export type HighlightWorkerResponse =
  | { type: "highlighted"; requestId: string; lines: HighlightToken[][] }
  | { type: "highlight-error"; requestId: string; error: string };

// Matches this product's dark console theme (`--vx-console-*`, §7's palette).
const THEME = "github-dark-default";
const PLAIN_LANG = "text";

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ themes: [THEME], langs: [] });
  }
  return highlighterPromise;
}

async function resolveLang(highlighter: Highlighter, requested: string): Promise<string | null> {
  if (requested === PLAIN_LANG) return null;
  if (loadedLangs.has(requested)) return requested;
  try {
    await highlighter.loadLanguage(requested as Parameters<Highlighter["loadLanguage"]>[0]);
    loadedLangs.add(requested);
    return requested;
  } catch {
    // Unknown/unsupported fence-language hint (or a made-up one) — fall back
    // to plain, uncolored tokens rather than failing the highlight pass.
    return null;
  }
}

function toPlainLines(code: string): HighlightToken[][] {
  return code.split("\n").map((line) => [{ content: line }]);
}

self.onmessage = async (event: MessageEvent<HighlightWorkerRequest>) => {
  const { data } = event;
  if (data.type !== "highlight") return;

  try {
    const requestedLang = (data.lang ?? PLAIN_LANG).toLowerCase().trim() || PLAIN_LANG;

    if (requestedLang === PLAIN_LANG) {
      const response: HighlightWorkerResponse = {
        type: "highlighted",
        requestId: data.requestId,
        lines: toPlainLines(data.code),
      };
      (self as unknown as Worker).postMessage(response);
      return;
    }

    const highlighter = await getHighlighter();
    const lang = await resolveLang(highlighter, requestedLang);

    const lines: HighlightToken[][] = lang
      ? highlighter
          // `lang` was resolved (and, if needed, dynamically loaded) at
          // runtime by `resolveLang` above — it isn't statically known to be
          // one of Shiki's bundled language ids, hence the cast.
          .codeToTokens(data.code, { lang: lang as BundledLanguage, theme: THEME })
          .tokens.map((line) => line.map((token) => ({ content: token.content, color: token.color, fontStyle: token.fontStyle })))
      : toPlainLines(data.code);

    const response: HighlightWorkerResponse = { type: "highlighted", requestId: data.requestId, lines };
    (self as unknown as Worker).postMessage(response);
  } catch (error) {
    const response: HighlightWorkerResponse = {
      type: "highlight-error",
      requestId: data.requestId,
      error: error instanceof Error ? error.message : "Syntax highlighting failed.",
    };
    (self as unknown as Worker).postMessage(response);
  }
};
