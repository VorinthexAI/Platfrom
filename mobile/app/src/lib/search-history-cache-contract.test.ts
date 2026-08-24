import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [archive, gallery, signal, compass, appSearch] = await Promise.all([
  read("../components/capability/KnowledgeWorkspace.tsx"),
  read("../components/capability/GalleryWorkspace.tsx"),
  read("../components/capability/EmailWorkspace.tsx"),
  read("../components/capability/TravelWorkspace.tsx"),
  read("./app-search-client.ts"),
]);

test("every workspace search history sheet uses the singleton user cache", () => {
  for (const workspace of [archive, gallery, signal, compass]) {
    expect(workspace).toContain("<SearchHistorySheet");
    expect(workspace).toContain('from "@/lib/user-search-history-cache"');
    expect(workspace).toContain("userSearchHistoryQueryKey(");
    expect(workspace).toContain("getUserSearchHistory(queryClient,");
    expect(workspace).toContain("promoteCachedUserSearchHistory(queryClient,");
    expect(workspace).toContain("removeCachedUserSearchHistory(queryClient,");
    expect(workspace).not.toContain("listContentSearchHistory");
  }
});

test("recorded searches invalidate history only through the shared app-search boundary", () => {
  expect(appSearch).toContain("if (parsed.recordHistory) publishUserSearchHistoryAppend");
  for (const workspace of [archive, gallery, signal, compass]) {
    expect(workspace).not.toMatch(/invalidateQueries\(\{ queryKey: (?:contentQueryKeys\.history|userSearchHistoryQueryKey)/);
  }
});
