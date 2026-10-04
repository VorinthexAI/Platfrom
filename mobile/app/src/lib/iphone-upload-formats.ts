/** Identify iPhone library formats before handing files to the ordinary upload flow. */
export function iphoneMediaFormat(name: string | null | undefined, mimeType: string | null | undefined, type?: string | null) {
  const extension = name?.toLowerCase().split(".").pop();
  const mime = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  if (type === "image" || type === "livePhoto" || mime?.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "tif", "tiff", "bmp"].includes(extension ?? "")) return "convert-png" as const;
  if (extension === "mov" || mime === "video/quicktime") return "keep-mov" as const;
  return undefined;
}

export function iphoneMediaFilename(name: string | null | undefined, mimeType: string | null | undefined, type: string | null | undefined, index: number) {
  const format = iphoneMediaFormat(name, mimeType, type);
  if (name?.trim()) {
    const filename = name.trim();
    return format === "keep-mov" && !filename.toLowerCase().endsWith(".mov") ? `${filename.replace(/\.[^.]+$/, "")}.mov` : filename;
  }
  const mime = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  const extension = format === "convert-png" ? mime === "image/heic" || mime === "image/heif" ? "heic" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg" : format === "keep-mov" ? "mov" : type === "video" || type === "pairedVideo" ? "mp4" : "jpg";
  return `media-${index + 1}.${extension}`;
}

export function convertedPngFilename(name: string) {
  return `${name.replace(/\.[^.]+$/, "")}.png`;
}
