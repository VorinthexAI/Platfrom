import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [mobileSheet, webSheet, mobileButton, webButton, agents, theme, core, switcher, travel, email, ascend, gallery, sharing, archive] = await Promise.all([
  read("../../../../shared/packages/ui/components/bottom-sheet/bottom-sheet.mobile.tsx"),
  read("../../../../shared/packages/ui/components/bottom-sheet/bottom-sheet.web.tsx"),
  read("../../../../shared/packages/ui/components/button/button.mobile.tsx"),
  read("../../../../shared/packages/ui/components/button/button.web.tsx"),
  read("../../../../AGENTS.md"),
  read("../../../../shared/packages/ui/theme.css"),
  read("../../../../shared/packages/ui/components/core-composer/core-composer.mobile.tsx"),
  read("../components/capability/WorkspaceAppSwitcher.tsx"),
  read("../components/capability/TravelWorkspace.tsx"),
  read("../components/capability/EmailWorkspace.tsx"),
  read("../components/capability/AscendWorkspace.tsx"),
  read("../components/capability/GalleryWorkspace.tsx"),
  read("../components/capability/GalleryCollectionSharing.tsx"),
  read("../components/capability/KnowledgeWorkspace.tsx"),
]);

test("enforces medium buttons throughout every BottomSheet", () => {
  for (const button of [mobileButton, webButton]) {
    expect(button).toContain("const ButtonSizeContext = createContext<ButtonSize | undefined>(undefined)");
    expect(button).toContain("const size = useContext(ButtonSizeContext) ?? requestedSize");
  }
  for (const sheet of [mobileSheet, webSheet]) {
    expect(sheet).toContain('<ButtonSizeProvider size="md">');
    expect(sheet).toContain('export type BottomSheetItemProps = Omit<ButtonProps, "size">');
    expect(sheet).toContain('size="md"');
    expect(sheet).not.toContain('size = "lg"');
  }
  expect(agents).toContain("Every button rendered anywhere inside a `BottomSheet`");
  expect(agents).toContain("`BottomSheetItem` must not expose a size override");
});

test("exposes only intrinsic and full BottomSheet heights", () => {
  for (const implementation of [mobileSheet, webSheet]) {
    expect(implementation).toContain('height?: "full"');
    expect(implementation).not.toContain("mutation?: boolean");
    expect(implementation).not.toContain("tall?: boolean");
  }
  expect(mobileSheet).toContain('const fullHeight = height === "full"');
  expect(mobileSheet).toContain("fullHeight && styles.fullSheet");
  expect(mobileSheet).not.toContain("tallSheet");
  expect(mobileSheet).not.toContain("mutationSheet");
  expect(webSheet).toContain('height === "full" ? " vui-bottom-sheet-full"');
  expect(theme).toContain(".vui-bottom-sheet-full {");
  expect(theme).toContain(".vui-bottom-sheet-full .vui-bottom-sheet-content {");
  expect(theme).toContain("flex: 1;\n  min-height: 0;\n  overflow-y: auto;");
  expect(theme).not.toContain(".vui-bottom-sheet-tall");
  expect(theme).not.toContain(".vui-bottom-sheet-mutation");
});

test("uses no legacy BottomSheet sizing props", () => {
  for (const consumer of [core, switcher, travel, email, ascend, gallery, sharing, archive]) {
    expect(consumer).not.toMatch(/<BottomSheet[\s\S]*?\b(?:mutation|tall)=/);
  }
});

test("classifies every full-height sheet workflow explicitly", () => {
  expect(core).toContain('<BottomSheet height="full"');
  expect(switcher).not.toContain("height=");
  expect(travel).toContain('<BottomSheet height="full"');
  expect(email).toContain('height={sheet === "reply" ? "full" : undefined}');
  expect(email).toContain('style={sheet === "reply" ? styles.fullSheetScroll : undefined}');
  expect(ascend).toContain('height={sheet === "create" || sheet === "reader" ? "full" : undefined}');
  expect(gallery).toContain('height="full"');
  expect(gallery).toContain('height={activeSheet === "destination" || activeSheet === "imageEdit"');
  expect(sharing).toContain('height={fullHeight ? "full" : undefined}');
  expect(archive).toContain('height={activeSheet === "documents"');
});
