import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [core, switcher, archive, gallery, compass, signal, ascend] = await Promise.all([
  read("../../../../shared/packages/ui/components/core-composer/core-composer.mobile.tsx"),
  read("../components/capability/WorkspaceAppSwitcher.tsx"),
  read("../components/capability/KnowledgeWorkspace.tsx"),
  read("../components/capability/GalleryWorkspace.tsx"),
  read("../components/capability/TravelWorkspace.tsx"),
  read("../components/capability/EmailWorkspace.tsx"),
  read("../components/capability/AscendWorkspace.tsx"),
]);

test("opens Core as an in-layout page and returns without routing", () => {
  expect(core).not.toContain("BottomSheet");
  expect(core).not.toContain("useRouter");
  expect(core).toContain('const [pageOpen, setPageOpen] = useState(false)');
  expect(core).toContain('accessibilityLabel="Back from Core"');
  expect(core).toContain("onRequestClose={closePage}");
  expect(core).toContain("onShow={focusPageInput}");
  expect(core).toContain('animationType="none"');
  expect(core).toContain("setPageOpen(false)");
  expect(core).toContain('presentationStyle="fullScreen"');
  expect(core).toContain("accessibilityViewIsModal onAccessibilityEscape={closePage}");
  expect(core).toContain("AccessibilityInfo.setAccessibilityFocus(inputHandle)");
  expect(core).toContain("showSoftInputOnFocus={expanded}");
  expect(core).toContain("valueRef.current.length");
});

test("matches the Archive header rhythm and keeps the Core prompt composer", () => {
  expect(core).toContain("pageIdentityHeader: {");
  expect(core).toContain("minHeight: 64");
  expect(core).toContain("paddingTop: insets.top + 6");
  expect(core).toContain("pageTitleRow: {");
  expect(core).toContain("minHeight: 48");
  expect(core).toContain("gap: spacing.xs");
  expect(core).toContain("fontSize: 24");
  expect(core).toContain("<RotatingPrompt prompts={prompts} />");
  expect(core).toContain("multiline={expanded}");
  expect(core).toContain('size={expanded ? "md" : "sm"}');
});

test("keeps the workspace composer compact and grows the Core input only when text wraps", () => {
  expect(core).toContain("const multiline = expanded && inputHeight > COLLAPSED_INPUT_HEIGHT");
  expect(core).toContain("height: expanded ? inputHeight : COLLAPSED_INPUT_HEIGHT");
  expect(core).toContain("{expanded && value.length > 0 ? <Text");
  expect(core).toContain("const lineCount = Math.min(6, Math.max(1, nativeEvent.lines.length))");
  expect(core).toContain("setInputHeight((current) => current === nextHeight ? current : nextHeight)");
  expect(core).not.toContain('borderColor: "#55616C"');
});

test("reuses the 300ms Core keyboard lift without double keyboard avoidance", () => {
  expect(core).toContain("const keyboardVisible = useKeyboard()");
  expect(core).toContain("withTiming(pageOpen && keyboardVisible ? 300 : 0, { duration: 300 })");
  expect(core).toContain('<Reanimated.View pointerEvents="none" style={keyboardSpacerStyle} />');
  expect(core).not.toContain("KeyboardAvoidingView");
});

test("temporarily displays Core while the selector remains limited to five apps", () => {
  expect(switcher).toContain('identity?: "active" | "core"');
  expect(switcher).toContain('identity === "core" ? "Core" : selected.name');
  expect(switcher).toContain('identity === "core" ? assistantIconSource');
  expect(switcher).toContain("onSelectActive?.()");
  const availableApps = switcher.match(/const AVAILABLE_APPS:[\s\S]*?\];/)?.[0] ?? "";
  for (const name of ["Archive", "Gallery", "Compass", "Signal", "Ascend"]) expect(availableApps).toContain(`name: "${name}"`);
  expect(availableApps).not.toContain('name: "Core"');
});

test("every workspace supplies its underlying app to the temporary Core identity", () => {
  expect(archive).toContain('<WorkspaceAppSwitcher active="archive" identity="core" onSelectActive={closeCore} />');
  expect(gallery).toContain('<WorkspaceAppSwitcher active="gallery" identity="core" onSelectActive={closeCore} />');
  expect(compass).toContain('<WorkspaceAppSwitcher active="compass" identity="core" onSelectActive={closeCore} />');
  expect(signal).toContain('<WorkspaceAppSwitcher active="signal" identity="core" onBeforeSelect={(slug) => requestExit(slug)} onSelectActive={closeCore} />');
  expect(ascend).toContain('<WorkspaceAppSwitcher active="ascend" identity="core" onBeforeSelect={() => !(creating && dirty)} onSelectActive={closeCore} />');
});
