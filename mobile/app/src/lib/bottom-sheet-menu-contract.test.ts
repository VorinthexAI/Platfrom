import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");
const nativeSheet = readFileSync(resolve(root, "shared/packages/ui/components/bottom-sheet/bottom-sheet.mobile.tsx"), "utf8");
const webSheet = readFileSync(resolve(root, "shared/packages/ui/components/bottom-sheet/bottom-sheet.web.tsx"), "utf8");
const theme = readFileSync(resolve(root, "shared/packages/ui/theme.css"), "utf8");

test("keeps menu spacing explicit without changing generic sheet layouts", () => {
  expect(nativeSheet).toContain("export function BottomSheetMenu");
  expect(nativeSheet).toContain("menu: { gap: 12 }");
  expect(nativeSheet).toContain("content: { gap: 6 }");
  expect(nativeSheet).toContain("footer: { gap: 8");
  expect(webSheet).toContain('"vui-bottom-sheet-menu"');
  expect(theme).toMatch(/\.vui-bottom-sheet-menu \{[\s\S]*?gap: 12px;/);
  expect(theme).toMatch(/\.vui-bottom-sheet-content \{[\s\S]*?gap: 6px;/);
});

test("uses the shared menu layout across app option sheets", () => {
  for (const file of ["AscendWorkspace.tsx", "KnowledgeWorkspace.tsx", "GalleryWorkspace.tsx", "GalleryCollectionSharing.tsx", "EmailWorkspace.tsx", "TravelWorkspace.tsx", "WorkspaceAppSwitcher.tsx"]) {
    expect(readFileSync(resolve(root, `mobile/app/src/components/capability/${file}`), "utf8"), file).toContain("<BottomSheetMenu>");
  }
});
