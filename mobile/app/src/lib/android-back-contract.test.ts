import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [layout, sheet, core, camera] = await Promise.all([
  read("../app/_layout.tsx"),
  read("../../../../shared/packages/ui/components/bottom-sheet/bottom-sheet.mobile.tsx"),
  read("../../../../shared/packages/ui/components/core-composer/core-composer.mobile.tsx"),
  read("../components/capability/BrandedCameraModal.tsx"),
]);

test("lets native presentations handle Android back before router history", () => {
  expect(sheet).toContain("onRequestClose={dismiss}");
  expect(core).toContain("onRequestClose={closePage}");
  expect(camera).toContain('onRequestClose={() => { if (!capturing && !disabled) onClose(); }}');
});

test("does not replace the active workspace with Archive on Android back", () => {
  expect(layout).not.toContain("hardwareBackPress");
  expect(layout).not.toContain("BackHandler");
  expect(layout).not.toMatch(/hardwareBackPress[\s\S]*?router\.replace\("\/capability\/archive"\)/);
});
