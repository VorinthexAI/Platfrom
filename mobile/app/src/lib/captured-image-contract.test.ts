import { expect, test } from "bun:test";

const source = await Bun.file(new URL("captured-image.ts", import.meta.url)).text();

test("supports product-specific PNG and smaller JPEG normalization while retaining capture coordinates", () => {
  expect(source).toContain("export async function normalizeCapturedPng");
  expect(source).toContain("ImageManipulator.SaveFormat.PNG");
  expect(source).toContain('mimeType: "image/png" as const');
  expect(source).toContain('extension: "png" as const');
  expect(source).toContain("export async function normalizeCapturedJpeg");
  expect(source).toContain("ImageManipulator.SaveFormat.JPEG");
  expect(source).toContain('mimeType: "image/jpeg" as const');
  expect(source).toContain('extension: "jpg" as const');
  expect(source).toContain("...coordinates");
});
