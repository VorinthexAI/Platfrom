import type { EmailConnector, EmailThread } from "./email-client";

export type EmailTrashGroup = { connector: EmailConnector; threads: EmailThread[]; error?: string };

export async function loadEmailTrashGroups(
  connectors: readonly EmailConnector[],
  loadPage: (connectorKey: string, cursor?: string) => Promise<{ threads: EmailThread[]; nextCursor: string | null }>,
  isCurrent: () => boolean,
  errorMessage: (error: unknown) => string,
  maxPages = 10_000,
) {
  const groups: EmailTrashGroup[] = [];
  for (const connector of connectors) {
    try {
      let cursor: string | undefined;
      const seenCursors = new Set<string>();
      const threads: EmailThread[] = [];
      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const page = await loadPage(connector.connectorKey, cursor);
        if (!isCurrent()) return undefined;
        threads.push(...page.threads.filter((thread) => !threads.some(({ key }) => key === thread.key)));
        const nextCursor = page.nextCursor ?? undefined;
        if (!nextCursor) break;
        if (seenCursors.has(nextCursor)) throw new Error("Trash pagination repeated a cursor.");
        seenCursors.add(nextCursor);
        cursor = nextCursor;
        if (pageIndex === maxPages - 1) throw new Error("Trash pagination exceeded the safe page limit.");
      }
      groups.push({ connector, threads });
    } catch (error) {
      if (!isCurrent()) return undefined;
      groups.push({ connector, threads: [], error: errorMessage(error) });
    }
  }
  return groups;
}
