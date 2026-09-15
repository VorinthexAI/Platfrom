export function safeFileName(value: string) {
  const normalized = value.replace(/[\\/:*?"<>|]/g, "_").trim();
  return normalized || "download";
}

const imageExtensions: Record<string, string> = {
  "image/gif": "gif", "image/heic": "heic", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

export function stableDownloadFileName(fileName: string, mimeType: string) {
  const extension = imageExtensions[mimeType.toLocaleLowerCase()] ?? "bin";
  const safe = safeFileName(fileName).replace(/\.+$/g, "").slice(0, 180);
  const stem = safe.replace(/\.[^.]+$/, "") || "image";
  return `${stem}.${extension}`;
}
