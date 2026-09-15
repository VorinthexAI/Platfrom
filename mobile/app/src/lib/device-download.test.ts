import { expect, test } from "bun:test";
import { stableDownloadFileName } from "./download-filename";
const source = await Bun.file(new URL("device-download.ts", import.meta.url)).text();

test("builds stable sanitized image filenames from the trusted MIME type", () => {
  expect(stableDownloadFileName(' trip/cover?.jpeg ', "image/png")).toBe("trip_cover_.png");
  expect(stableDownloadFileName("portrait.png", "image/jpeg")).toBe("portrait.jpg");
  expect(stableDownloadFileName("...", "image/webp")).toBe("image.webp");
});

test("saves URL downloads to public Android Downloads and private iOS Documents/Downloads", () => {
  expect(source).toContain('MediaCollection.copyToMediaStore({ name, parentFolder: "", mimeType }, "Download"');
  expect(source).toContain('new File(Paths.document, "Downloads", name)');
  expect(source).toContain("File.downloadFileAsync(url, file, { idempotent: true })");
  expect(source).not.toContain("expo-media-library");
});
