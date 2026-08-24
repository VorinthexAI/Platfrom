export type GuideContentSection = { heading?: string; body: string };
export type GuideTextRun = { text: string; style?: "strong" | "emphasis" | "code" | "strikethrough" };
export type GuideBodyLine = { marker?: string; runs: GuideTextRun[] };

function markdownLabel(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .trim();
}

export function normalizeGuideContent(value: string) {
  const normalized = value.replace(/\r\n?/g, "\n");
  let output = "";
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] !== "\\") {
      output += normalized[index];
      continue;
    }
    let end = index;
    while (normalized[end] === "\\") end += 1;
    const slashCount = end - index;
    if (normalized[end] === "n" && slashCount === 1) {
      output += "\n";
      index = end;
    } else {
      output += normalized.slice(index, end);
      index = end - 1;
    }
  }
  return output.trim();
}

export function formatGuideContent(value: string): GuideContentSection[] {
  const normalized = normalizeGuideContent(value);
  if (!normalized) return [];

  const sections: GuideContentSection[] = [];
  let heading: string | undefined;
  let body: string[] = [];
  const flush = () => {
    const content = body.join("\n").trim();
    if (content) sections.push({ ...(heading ? { heading } : {}), body: content });
    body = [];
  };

  for (const line of normalized.split("\n")) {
    const markdownHeading = line.trim().match(/^#{1,6}\s+(.+)$/)?.[1]?.trim();
    const plainHeading = markdownLabel(markdownHeading ?? line.trim()).match(/^([^:]{1,80}):$/)?.[1]?.trim();
    const nextHeading = markdownHeading ? markdownLabel(markdownHeading) : plainHeading;
    if (nextHeading) {
      flush();
      heading = nextHeading;
    } else {
      body.push(line);
    }
  }
  flush();
  return sections;
}

export function formatGuideBody(value: string): GuideBodyLine[] {
  return value.split("\n").map((source) => {
    const unordered = source.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = source.match(/^\s*(\d+\.)\s+(.+)$/);
    const quote = source.match(/^\s*>\s?(.*)$/);
    const marker = unordered ? "\u2022" : ordered?.[1];
    const line = unordered?.[1] ?? ordered?.[2] ?? quote?.[1] ?? source;
    const normalized = line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    const runs: GuideTextRun[] = [];
    const pattern = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
    let offset = 0;
    for (const match of normalized.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > offset) runs.push({ text: normalized.slice(offset, index) });
      const token = match[0];
      const style = token.startsWith("**") || token.startsWith("__") ? "strong"
        : token.startsWith("~~") ? "strikethrough"
          : token.startsWith("`") ? "code" : "emphasis";
      runs.push({ text: markdownLabel(token.slice(style === "strong" || style === "strikethrough" ? 2 : 1, style === "strong" || style === "strikethrough" ? -2 : -1)), style });
      offset = index + token.length;
    }
    if (offset < normalized.length) runs.push({ text: normalized.slice(offset) });
    return { ...(marker ? { marker } : {}), runs };
  });
}
