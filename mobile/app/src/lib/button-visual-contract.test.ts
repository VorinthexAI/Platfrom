import { expect, test } from "bun:test";

const root = new URL("../../../../shared/packages/ui/", import.meta.url);
const mobile = await Bun.file(new URL("components/button/button.mobile.tsx", root)).text();
const theme = await Bun.file(new URL("theme.css", root)).text();

test("uses full-bleed native and CSS chrome primary gradients", () => {
  expect(mobile).toContain('import { LinearGradient } from "expo-linear-gradient"');
  expect(mobile).toContain('colors={["#FFFFFF", "#AEB6BC", "#3C434A", "#F5F7F8", "#7B858C", "#FFFFFF"]}');
  expect(mobile).toContain("locations={[0, 0.18, 0.38, 0.55, 0.76, 1]}");
  expect(mobile).toContain("style={StyleSheet.absoluteFill}");
  expect(mobile).toContain('overflow: "hidden"');
  expect(mobile).not.toContain("LayoutChangeEvent");
  expect(mobile).not.toContain("react-native-svg");
  expect(theme).toContain("--vui-gradient-chrome: linear-gradient(");
  expect(theme).toContain("background: var(--vui-gradient-chrome);");
  for (const variant of ["secondary", "outline", "danger", "icon"]) {
    expect(mobile).toContain(`${variant}: { backgroundColor: "#030507"`);
  }
  expect(mobile).toContain('darkLoadingSurface: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#080B0F" }');
  expect(mobile).not.toContain('danger: { backgroundColor: "#B04A4A"');
  expect(theme).toContain('.vui-button-danger,\n.vui-button-icon {\n  background: #030507;');
  expect(theme).not.toContain('background: var(--vui-color-danger);');
});
