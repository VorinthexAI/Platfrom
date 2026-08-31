import { describe, expect, test } from "bun:test";

const sharedRoot = new URL("../../../../shared/", import.meta.url);
const packageJson = await Bun.file(new URL("package.json", sharedRoot)).json();
const components = await Bun.file(new URL("packages/ui/components.ts", sharedRoot)).text();
const mobile = await Bun.file(new URL("packages/ui/components/pull-to-refresh/pull-to-refresh.mobile.tsx", sharedRoot)).text();
const web = await Bun.file(new URL("packages/ui/components/pull-to-refresh/pull-to-refresh.web.tsx", sharedRoot)).text();

describe("shared pull-to-refresh", () => {
  test("exports platform-specific implementations", () => {
    expect(packageJson.exports["./ui/pull-to-refresh"]).toEqual({
      "react-native": "./packages/ui/components/pull-to-refresh/pull-to-refresh.mobile.tsx",
      default: "./packages/ui/components/pull-to-refresh/pull-to-refresh.web.tsx",
    });
    expect(components).toContain("export * from './components/pull-to-refresh';");
  });

  test("brands the native refresh control with shared colors", () => {
    expect(mobile).toContain('import { RefreshControl, type StyleProp, type ViewStyle } from "react-native"');
    expect(mobile).toContain('import { colors } from "../../tokens"');
    expect(mobile).toContain("colors={[colors.accent]}");
    expect(mobile).toContain("progressBackgroundColor={colors.panelRaised}");
    expect(mobile).toContain("tintColor={colors.accent}");
    expect(mobile).toContain("titleColor={colors.muted}");
    expect(mobile).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  test("forwards the Android ScrollView child and layout style", () => {
    expect(mobile).toContain("children?: ReactNode");
    expect(mobile).toContain("style?: StyleProp<ViewStyle>");
    expect(mobile).toContain("style={style}");
    expect(mobile).toContain(">{children}</RefreshControl>");
  });

  test("keeps a no-op web counterpart for the shared contract", () => {
    expect(web).toContain("export interface PullToRefreshProps");
    expect(web).toContain("return null;");
  });
});
