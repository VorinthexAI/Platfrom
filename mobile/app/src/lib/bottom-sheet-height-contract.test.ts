import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [mobileSheet, webSheet, mobileButton, webButton, mobileToast, agents, theme, core, switcher, travel, email, ascend, gallery, sharing, archive] = await Promise.all([
  read("../../../../shared/packages/ui/components/bottom-sheet/bottom-sheet.mobile.tsx"),
  read("../../../../shared/packages/ui/components/bottom-sheet/bottom-sheet.web.tsx"),
  read("../../../../shared/packages/ui/components/button/button.mobile.tsx"),
  read("../../../../shared/packages/ui/components/button/button.web.tsx"),
  read("../../../../shared/packages/ui/components/toast/toast.mobile.tsx"),
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

test("enforces medium BottomSheet actions while allowing shared compact composites", () => {
  for (const button of [mobileButton, webButton]) {
    expect(button).toContain("const ButtonSizeContext = createContext<ButtonSizeContextValue | undefined>(undefined)");
    expect(button).toContain("const value = parent?.forced && !overrideParent ? parent : { size, forced: force }");
    expect(button).toContain("const size = useContext(ButtonSizeContext)?.size ?? requestedSize");
  }
  for (const sheet of [mobileSheet, webSheet]) {
    expect(sheet).toContain('<ButtonSizeProvider force size="md">');
    expect(sheet).toContain('export type BottomSheetItemProps = Omit<ButtonProps, "size">');
    expect(sheet).toContain('size="md"');
    expect(sheet).not.toContain('size = "lg"');
  }
  expect(mobileButton).toContain("overrideParent?: boolean");
  expect(agents).toContain("Shared compact composites such as `Tabs`, badges, and chip actions");
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

test("keeps the scene transformed until every stacked mobile sheet closes", () => {
  expect(mobileSheet).toContain("const openSheets = useRef(new Set<symbol>())");
  expect(mobileSheet).toContain("openSheets.current.add(id)");
  expect(mobileSheet).toContain("openSheets.current.delete(id)");
  expect(mobileSheet).toContain("const hasOpenSheet = openSheets.current.size > 0");
});

test("renders the shared toast viewport inside native mobile sheets", () => {
  expect(mobileToast).toContain("export function ToastViewport()");
  expect(mobileToast).toContain("<ToastViewport />");
  expect(mobileSheet).toContain('import { ToastViewport } from "../toast/toast.mobile"');
  expect(mobileSheet).toContain("<ToastViewport />");
  expect(mobileToast).toContain('viewport: { elevation: 1000');
  expect(mobileToast).toContain('zIndex: 1000');
});

test("keeps mobile sheet surfaces and fixed footers above the keyboard", () => {
  expect(mobileSheet).toContain("KeyboardAvoidingView");
  expect(mobileSheet).toContain('behavior={Platform.OS === "ios" ? "padding" : fullHeight ? undefined : "height"}');
  expect(mobileSheet).toMatch(/<KeyboardAvoidingView[\s\S]*?<SheetSurface[\s\S]*?<\/KeyboardAvoidingView>/);
  expect(mobileSheet).toContain("paddingBottom: androidBottomInset");
  expect(mobileSheet).toContain("bottomInset={insets.bottom}");
});

test("layers complete mobile sheet pages over a stationary previous page", () => {
  expect(mobileSheet).toContain("pageKey?: string");
  expect(mobileSheet).toContain("onSwipeLeft?: () => void");
  expect(mobileSheet).toContain("onSwipeRight?: () => void");
  expect(mobileSheet).toContain("const previous = pageSnapshotRef.current");
  expect(mobileSheet).toContain("pageDirectionRef.current * windowWidth");
  expect(mobileSheet).toContain("page={pageTransition.previous}");
  expect(mobileSheet).toContain("translateX: pageTranslateX");
  expect(mobileSheet).toContain("duration: 280");
  expect(mobileSheet).toContain('<GestureDetector gesture={horizontalSwipeGesture}><Animated.View');
  expect(mobileSheet).toContain("key={pageTransition.previous.pageKey}");
  expect(mobileSheet).toContain("key={presentedPage.pageKey}");
  expect(mobileSheet).toContain("pageTransition.previous.pageKey !== presentedPage.pageKey");
  expect(mobileSheet).not.toContain("setPageTransition({ pageKey, previous: livePage })");
  expect(mobileSheet).toContain("GestureHandlerRootView");
  expect(mobileSheet).toContain('import { scheduleOnRN } from "react-native-worklets"');
  expect(mobileSheet).toContain("scheduleOnRN(navigateHorizontal, translationX < 0 ? 1 : -1)");
  expect(mobileSheet).not.toContain(".runOnJS(true)");
  expect(mobileSheet).toContain("toValue: 0, useNativeDriver: false");
  expect(mobileSheet).toContain("style={[styles.layerSurface, transitioningPage && { transform: [{ translateX: pageTranslateX }] }]}");
});

test("classifies every full-height sheet workflow explicitly", () => {
  expect(core).toContain('<BottomSheet height="full"');
  expect(switcher).not.toContain("height=");
  expect(travel).toContain('height="full"');
  expect(email).toContain('height={sheet === "trashRoot" || formSheet ? "full" : undefined}');
  for (const title of ["Recipients", "Write email", "Choose a tone", "Email draft"]) expect(email).toMatch(new RegExp(`height="full"[\\s\\S]*?title="${title}"`));
  for (const title of ["Choose a topic", "Your topic", "Choose a goal", "Your goal", "Audio book details", "Extend audio book"]) expect(ascend).toMatch(new RegExp(`height="full"[\\s\\S]*?title="${title}"`));
  expect(ascend).toContain('{sheet === "chapterRead" ? <ChapterReading chapter={readingChapter} /> : null}');
  expect(ascend).not.toContain('"sleep"');
  expect(ascend).not.toContain('sheet === "detail"');
  expect(ascend).toContain('height={sheet === "reader" || sheet === "chapterRead" || sheet === "bookSummary" ? "full" : undefined}');
  expect(gallery).toContain('height="full"');
  expect(gallery).toContain('height={activeSheet === "destination" || activeSheet === "imageEdit"');
  expect(sharing).toContain('height={fullHeight ? "full" : undefined}');
  expect(archive).toContain('height={activeSheet === "documents"');
});
