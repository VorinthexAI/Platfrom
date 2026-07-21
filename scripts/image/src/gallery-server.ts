import path from "node:path";

const rootDir = path.resolve(import.meta.dir, "..");
const videoRootDir = path.resolve(rootDir, "../video");
const audioRootDir = path.resolve(rootDir, "../audio");
const port = Number(process.env.PORT ?? 4177);

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".opus": "audio/ogg",
  ".pcm": "audio/pcm",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".md": "text/markdown; charset=utf-8"
};

function safePath(urlPath: string): string | undefined {
  const pathname = decodeURIComponent(new URL(urlPath, "http://localhost").pathname);
  if (pathname === "/" || pathname === "/assets" || pathname === "/assets.html") return path.join(rootDir, "assets.html");
  if (pathname === "/gallery.html") return path.join(rootDir, "assets.html");
  if (pathname === "/video-registry/videos.json") return path.join(videoRootDir, "registry/videos.json");
  if (pathname === "/audio-registry/audio.json") return path.join(audioRootDir, "registry/audio.json");
  if (pathname.startsWith("/video-assets/")) {
    const resolved = path.resolve(videoRootDir, pathname.replace(/^\/video-assets\//, ""));
    if (!resolved.startsWith(videoRootDir)) return undefined;
    return resolved;
  }
  if (pathname.startsWith("/audio-assets/")) {
    const resolved = path.resolve(audioRootDir, pathname.replace(/^\/audio-assets\//, ""));
    if (!resolved.startsWith(audioRootDir)) return undefined;
    return resolved;
  }
  const relativePath = pathname.replace(/^\/+/, "");
  const resolved = path.resolve(rootDir, relativePath);
  if (!resolved.startsWith(rootDir)) return undefined;
  return resolved;
}

Bun.serve({
  port,
  async fetch(request) {
    const filePath = safePath(request.url);
    if (!filePath) return new Response("Not found", { status: 404 });
    const file = Bun.file(filePath);
    if (!await file.exists()) return new Response("Not found", { status: 404 });
    return new Response(file, {
      headers: {
        "content-type": mimeTypes[path.extname(filePath)] ?? "application/octet-stream",
        "cache-control": "no-store"
      }
    });
  }
});

console.log(`Vorinthex assets library: http://localhost:${port}`);
