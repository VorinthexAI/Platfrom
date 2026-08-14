export type ScanSessionPage = { id: string; uri: string; sizeBytes: number };

export const MAX_DOCUMENT_SCAN_PAGES = 12;
export const MAX_DOCUMENT_SCAN_BYTES = 16 * 1024 * 1024;

export function appendScanPage(pages: ScanSessionPage[], page: ScanSessionPage) {
  return pages.length >= MAX_DOCUMENT_SCAN_PAGES ? pages : [...pages, page];
}

export function removeScanPage(pages: ScanSessionPage[], id: string) {
  return pages.filter((page) => page.id !== id);
}

export function scanSessionSize(pages: ScanSessionPage[]) {
  return pages.reduce((total, page) => total + page.sizeBytes, 0);
}
