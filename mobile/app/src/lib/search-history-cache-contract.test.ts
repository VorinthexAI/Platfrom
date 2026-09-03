import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const normalize = (source: string) => source.replace(/\s+/g, "").replace(/,([}\]])/g, "$1").replace(/\?\((?=<)/g, "?");
const [archive, gallery, signal, compass, ascend, attachmentPicker, appSearch] = await Promise.all([
  read("../components/capability/KnowledgeWorkspace.tsx"),
  read("../components/capability/GalleryWorkspace.tsx"),
  read("../components/capability/EmailWorkspace.tsx"),
  read("../components/capability/TravelWorkspace.tsx"),
  read("../components/capability/AscendWorkspace.tsx"),
  read("../components/capability/EmailAttachmentPicker.tsx"),
  read("./app-search-client.ts"),
]);

test("every workspace search history sheet uses the singleton user cache", () => {
  for (const workspace of [archive, gallery, signal, compass, ascend]) {
    expect(workspace).toContain("<SearchHistorySheet");
    expect(workspace).toContain('from "@/lib/user-search-history-cache"');
    expect(workspace).toContain("userSearchHistoryQueryKey(");
    expect(workspace).toContain("getUserSearchHistory(queryClient,");
    expect(workspace).toContain("promoteCachedUserSearchHistory(queryClient,");
    expect(workspace).toContain("removeCachedUserSearchHistory(queryClient,");
    expect(workspace).not.toContain("listContentSearchHistory");
  }
});

test("every filter-sheet Search history option matches the sheet background", () => {
  const workspaces = [archive, gallery, signal, compass, ascend, attachmentPicker];
  const expectedCounts = [1, 2, 2, 1, 1, 1];
  for (const [index, workspace] of workspaces.entries()) {
    const source = workspace === gallery ? normalize(workspace) : workspace;
    const pattern = workspace === gallery ? /style=\{styles\.searchHistoryOption\}variant="secondary">Searchhistory<\/Button>/g : /style=\{styles\.searchHistoryOption\} variant="secondary">Search history<\/Button>/g;
    expect(source.match(pattern)).toHaveLength(expectedCounts[index]!);
    expect(workspace).toContain("searchHistoryOption: { backgroundColor: palette.page }");
  }
});

test("recorded searches invalidate history only through the shared app-search boundary", () => {
  expect(appSearch).toContain("if (parsed.recordHistory) publishUserSearchHistoryAppend");
  for (const workspace of [archive, gallery, signal, compass, ascend]) {
    expect(workspace).not.toMatch(/invalidateQueries\(\{ queryKey: (?:contentQueryKeys\.history|userSearchHistoryQueryKey)/);
  }
});
