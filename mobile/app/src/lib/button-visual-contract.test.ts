import { expect, test } from "bun:test";

const root = new URL("../../../../shared/packages/ui/", import.meta.url);
const mobile = await Bun.file(new URL("components/button/button.mobile.tsx", root)).text();
const theme = await Bun.file(new URL("theme.css", root)).text();

test("limits shared buttons to chrome primary and dark non-primary visuals", () => {
  for (const variant of ["secondary", "outline", "danger", "icon"]) {
    expect(mobile).toContain(`${variant}: { backgroundColor: "#030507"`);
  }
  expect(mobile).toContain('darkLoadingSurface: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#080B0F" }');
  expect(mobile).not.toContain('danger: { backgroundColor: "#B04A4A"');
  expect(theme).toContain('.vui-button-danger,\n.vui-button-icon {\n  background: #030507;');
  expect(theme).not.toContain('background: var(--vui-color-danger);');
});
