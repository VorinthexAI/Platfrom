import { expect, test } from "bun:test";

const editor = await Bun.file(new URL("../../../../shared/packages/ui/components/ai-text-editor/ai-text-editor.mobile.tsx", import.meta.url)).text();
const signal = await Bun.file(new URL("../components/capability/EmailWorkspace.tsx", import.meta.url)).text();
const ascend = await Bun.file(new URL("../components/capability/AscendWorkspace.tsx", import.meta.url)).text();

test("uses one non-overlapping AI editor control across Signal and Ascend", () => {
  expect(signal.match(/<AiTextEditor accessibilityLabel=/g)).toHaveLength(4);
  expect(ascend.match(/<AiTextEditor accessibilityLabel=/g)).toHaveLength(2);
  expect(editor).toContain("<View style={styles.actions}><Button");
  expect(editor).toContain("Keyboard.dismiss(); onOpenActions();");
  expect(editor).toContain("style={[styles.input, style]}");
  expect(editor).toContain('root: { width: "100%", height: 280');
  expect(editor).toContain('flex: 1, flexBasis: 0');
  expect(editor).toContain('height: 58, minHeight: 58, maxHeight: 58, flexShrink: 0, flexDirection: "row"');
  expect(editor).toContain('icon={<BrainIcon size="sm" />} iconOnly');
  expect(editor).toContain('style={styles.aiButton} variant="icon"');
  expect(editor).not.toContain('>AI</Button>');
  expect(editor).not.toContain("borderTopWidth");
  expect(editor).not.toContain("colors.surface");
  expect(editor).not.toContain("disabled={!value.trim()}");
  expect(editor).not.toContain('position: "absolute"');
  expect(editor).not.toContain("zIndex");
  expect(ascend).not.toContain("customEditorStep");
  expect(ascend).not.toContain('if (briefTransformation || !briefEditorText(target).trim()) return;');
  expect(signal).not.toContain('if (editorTransformation || !emailEditorText(target).trim()) return;');
});
