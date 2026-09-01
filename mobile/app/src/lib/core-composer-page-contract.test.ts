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
  expect(core).not.toContain("<Modal");
  expect(core).not.toContain("useRouter");
  expect(core).toContain('const [pageOpen, setPageOpen] = useState(false)');
  expect(core).toContain('accessibilityLabel="Back from Core"');
  expect(core).toContain("<CorePage");
  expect(core).toContain("CORE_FOCUS_DELAY_MS = 100");
  expect(core).toContain("inputRef.current?.focus()");
  expect(core).toContain("setPageOpen(false)");
  expect(core).toContain("accessibilityViewIsModal onAccessibilityEscape={closePage}");
  expect(core).toContain("onAccessibilityEscape={closePage}");
  expect(core).toContain("AccessibilityInfo.setAccessibilityFocus(inputHandle)");
  expect(core).toContain("showSoftInputOnFocus={expanded}");
  expect(core).toContain("valueRef.current.length");
});

test("matches the Archive header rhythm and keeps the Core prompt composer", () => {
  expect(core).toContain("pageIdentityHeader: {");
  expect(core).toContain("minHeight: 64");
  expect(core).toContain("paddingTop: topInset + 6");
  expect(core).toContain("pageTitleRow: {");
  expect(core).toContain("minHeight: 48");
  expect(core).toContain("gap: spacing.xs");
  expect(core).toContain("fontSize: 24");
  expect(core).toContain("<RotatingPrompt prompts={prompts} />");
  expect(core).toContain("multiline={expanded}");
  expect(core).not.toContain('size={expanded ? "md" : "sm"}');
  expect(core).toContain('size="sm"');
  expect(core).not.toContain("expandedSend");
});

test("keeps the workspace composer compact and grows the Core input only when text wraps", () => {
  expect(core).toContain("const multiline = expanded && inputHeight > COLLAPSED_INPUT_HEIGHT");
  expect(core).toContain("return <View style={[styles.composer, multiline && styles.composerOpen]}>");
  expect(core).toContain("height: expanded ? inputHeight : COLLAPSED_INPUT_HEIGHT");
  expect(core).toContain("{expanded && value.length > 0 ? <Text");
  expect(core).toContain("const lineCount = Math.max(1, nativeEvent.lines.length)");
  expect(core).toContain("setInputHeight((current) => current === nextHeight ? current : nextHeight)");
  expect(core).toContain('const inputValue = expanded ? value : (value.split(/\\r?\\n/)[0] ?? "")');
  expect(core).toContain("scrollEnabled={expanded && inputLineCount > 6}");
  expect(core).not.toContain('borderColor: "#55616C"');
});

test("waits for the keyboard to hide and restores the workspace composer without a delayed flash", () => {
  expect(core).toContain('Keyboard.addListener("keyboardDidHide", finishClose)');
  expect(core).toContain("if (!Keyboard.isVisible()) finishClose()");
  expect(core).toContain('!pageOpen ? <View pointerEvents="box-none"');
  expect(core).not.toContain("collapsedVisible");
});

test("delays focus by 100ms and keeps the horizontal page inset above the keyboard", () => {
  expect(core).toContain("useAnimatedKeyboard({");
  expect(core).toContain("KeyboardState.OPENING");
  expect(core).toContain("const keyboardLift = Math.max(0, keyboard.height.value - bottomInset)");
  expect(core).toContain("keyboardMoving ? keyboardLift + Math.min(spacing.md, keyboardLift) : 0");
  expect(core).toContain("}, CORE_FOCUS_DELAY_MS)");
  expect(core).toContain('{composer}\n        <Reanimated.View pointerEvents="none" style={keyboardSpacerStyle} />');
  expect(core).not.toContain("KeyboardAvoidingView");
  expect(core).not.toContain("withTiming");
});

test("keeps workspace keyboard avoidance from competing with the Core page", () => {
  for (const workspace of [archive, gallery, compass, signal, ascend]) expect(workspace).not.toContain("KeyboardAvoidingView");
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
