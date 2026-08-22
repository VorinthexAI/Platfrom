export type GuideContentSection = { heading?: string; body: string };

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
    const plainHeading = line.trim().match(/^([^:]{1,80}):$/)?.[1]?.trim();
    const nextHeading = markdownHeading ?? plainHeading;
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
