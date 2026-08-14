import { expect, test } from "bun:test";
import { appendScanPage, MAX_DOCUMENT_SCAN_BYTES, MAX_DOCUMENT_SCAN_PAGES, removeScanPage, scanSessionSize, type ScanSessionPage } from "./document-scan-session";

const page = (index: number, sizeBytes = 4): ScanSessionPage => ({ id: String(index), uri: `file:///page-${index}.jpg`, sizeBytes });

test("keeps captured pages in camera order", () => {
  const pages = [page(1), page(2)].reduce(appendScanPage, [] as ScanSessionPage[]);
  expect(pages.map(({ id }) => id)).toEqual(["1", "2"]);
});

test("caps a scan session at twelve pages", () => {
  const pages = Array.from({ length: MAX_DOCUMENT_SCAN_PAGES + 3 }, (_, index) => page(index)).reduce(appendScanPage, [] as ScanSessionPage[]);
  expect(pages).toHaveLength(MAX_DOCUMENT_SCAN_PAGES);
  expect(pages.at(-1)?.id).toBe("11");
});

test("removes only the selected page while preserving remaining order", () => {
  expect(removeScanPage([page(1), page(2), page(3)], "2").map(({ id }) => id)).toEqual(["1", "3"]);
});

test("leaves the session unchanged when removing an unknown page", () => {
  const pages = [page(1), page(2)];
  expect(removeScanPage(pages, "missing")).toEqual(pages);
});

test("totals normalized image bytes for the UI upload guard", () => {
  expect(scanSessionSize([page(1, 6 * 1024 * 1024), page(2, 10 * 1024 * 1024)])).toBe(MAX_DOCUMENT_SCAN_BYTES);
  expect(scanSessionSize([])).toBe(0);
});
