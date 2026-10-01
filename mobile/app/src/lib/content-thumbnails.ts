import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { createVideoPlayer } from "expo-video";

export type LocalThumbnail = { uri: string; sizeBytes: number; mimeType: "image/jpeg" };

export async function saveThumbnail(source: string | Parameters<typeof ImageManipulator.manipulate>[0]): Promise<LocalThumbnail> {
  const image = await ImageManipulator.manipulate(source).resize({ width: 512 }).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
  const sizeBytes = new File(saved.uri).size;
  if (!sizeBytes || sizeBytes > 2 * 1024 * 1024) { try { new File(saved.uri).delete(); } catch { /* Cache file may already be gone. */ } throw new Error("Thumbnail size is unsupported."); }
  return { uri: saved.uri, sizeBytes, mimeType: "image/jpeg" };
}

export async function createImageThumbnail(uri: string) {
  return saveThumbnail(uri);
}

export async function createVideoThumbnail(uri: string): Promise<LocalThumbnail> {
  const player = createVideoPlayer(uri);
  try {
    if (player.status !== "readyToPlay") {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { listener.remove(); reject(new Error("Video thumbnail timed out.")); }, 15_000);
        const listener = player.addListener("statusChange", ({ status }) => {
          if (status !== "readyToPlay" && status !== "error") return;
          clearTimeout(timer);
          listener.remove();
          if (status === "error") reject(new Error("Video could not be loaded for a thumbnail."));
          else resolve();
        });
        if (player.status === "readyToPlay") { clearTimeout(timer); listener.remove(); resolve(); }
      });
    }
    const second = player.duration > 4 ? 2 : Math.max(0, player.duration / 2);
    const [frame] = await player.generateThumbnailsAsync(second, { maxWidth: 512, maxHeight: 512 });
    if (!frame) throw new Error("No video thumbnail was available.");
    return saveThumbnail(frame);
  } finally {
    player.release();
  }
}
