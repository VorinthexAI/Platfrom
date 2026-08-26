import { expect, test } from "bun:test";

const source = await Bun.file(new URL("captured-image.ts", import.meta.url)).text();

test("normalizes captured images to PNG while retaining capture coordinates", () => {
  expect(source).toContain("export async function normalizeCapturedPng");
  expect(source).toContain("ImageManipulator.SaveFormat.PNG");
  expect(source).toContain('mimeType: "image/png" as const');
  expect(source).toContain('extension: "png" as const');
  expect(source).toContain("...coordinates");
  expect(source).not.toContain("SaveFormat.JPEG");
  expect(source).not.toContain("normalizeCapturedJpeg");
});
