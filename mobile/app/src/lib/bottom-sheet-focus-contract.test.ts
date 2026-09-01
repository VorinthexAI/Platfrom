import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");
const sheet = readFileSync(resolve(root, "shared/packages/ui/components/bottom-sheet/bottom-sheet.mobile.tsx"), "utf8");
const webSheet = readFileSync(resolve(root, "shared/packages/ui/components/bottom-sheet/bottom-sheet.web.tsx"), "utf8");
const input = readFileSync(resolve(root, "shared/packages/ui/components/text-input/text-input.mobile.tsx"), "utf8");
const composer = readFileSync(resolve(root, "shared/packages/ui/components/core-composer/core-composer.mobile.tsx"), "utf8");

test("mobile BottomSheet owns focus cycles and excludes inactive transition surfaces", () => {
  expect(sheet).toContain("focusKey?: string");
  expect(sheet).toContain('const focusCycleKey = focusKey ?? pageKey ?? "presentation"');
  expect(sheet).toContain("onShow={presentFocusCycle}");
  expect(sheet).toContain("bottomSheetFocusCoordinator.activate(sceneSheetId, focusCycleKeyRef.current)");
  expect(sheet.indexOf("const presentFocusCycle")).toBeLessThan(sheet.indexOf("bottomSheetFocusCoordinator.activate(sceneSheetId, focusCycleKeyRef.current)"));
  expect(sheet).toContain("bottomSheetFocusCoordinator.setCycle(sceneSheetId, focusCycleKey)");
  expect(sheet).toContain("bottomSheetFocusCoordinator.deactivate(sceneSheetId)");
  expect(sheet).toContain("active={focusActive && !inactive}");
});

test("shared mobile TextInput registers while preserving refs and consumer focus", () => {
  expect(input).toContain("registration?.register(inputId");
  expect(input).toContain('if (typeof ref === "function") ref(instance)');
  expect(input).toContain("else if (ref) ref.current = instance");
  expect(input).toContain("registration?.claim()");
  expect(input).toContain("onFocus?.(event)");
});

test("shared mobile TextInput lets Core expose its animated gradient prompt", () => {
  expect(input).toContain("style={[styles.input, styles.background, style]}");
  expect(composer).toContain('backgroundColor: "transparent"');
  expect(composer).toContain('<RotatingPrompt key={expanded ? "core-page" : "workspace"}');
  expect(composer).toContain("fill={`url(#${gradientId})`}");
});

test("web BottomSheet accepts focusKey without mobile focus coordination", () => {
  expect(webSheet).toContain("focusKey?: string");
  expect(webSheet).not.toContain("bottomSheetFocusCoordinator");
  expect(webSheet).not.toContain("BottomSheetFocusProvider");
});
