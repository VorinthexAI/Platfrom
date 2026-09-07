import { expect, test } from "bun:test";

const mobile = await Bun.file(new URL("./subtle-button.mobile.tsx", import.meta.url)).text();
const web = await Bun.file(new URL("./subtle-button.web.tsx", import.meta.url)).text();

test("subtle buttons preserve the shared Button hit target and size contract", () => {
  for (const source of [mobile, web]) {
    expect(source).toContain("<Button");
    expect(source).toContain('size = "md"');
  }
  expect(mobile).not.toMatch(/Pressable|Text\s+onPress/);
  expect(web).not.toMatch(/<button/);
});
