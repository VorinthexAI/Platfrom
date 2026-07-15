import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

/**
 * Bakes the approved chrome capability emblems into raw RGBA byte assets
 * for the mobile galaxy. On-device image decoding through expo-gl proved
 * unreliable (empty textures / black boxes on real hardware), so the
 * planet emblems ship as plain pixels the app feeds straight into a
 * three.js DataTexture — no decode step left to vary per device.
 *
 * Format: uint32 LE width, uint32 LE height, then width*height*4 bytes of
 * RGBA, top row first (the app flips via the texture transform).
 */

const BRAND_DIR = join(import.meta.dir, "../../../mobile/app/assets/brand");
const OUT_DIR = join(BRAND_DIR, "logo-data");
const SLUGS = ["archive", "gallery", "signal", "compass", "ascend"] as const;
const TARGET_SIZE = 256;

mkdirSync(OUT_DIR, { recursive: true });

for (const slug of SLUGS) {
  const sourcePath = join(BRAND_DIR, `capability-${slug}.png`);
  const { data, info } = await sharp(readFileSync(sourcePath))
    .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== TARGET_SIZE || info.height !== TARGET_SIZE || info.channels !== 4) {
    throw new Error(`unexpected raw output for ${slug}: ${JSON.stringify(info)}`);
  }

  const out = Buffer.alloc(8 + data.length);
  out.writeUInt32LE(info.width, 0);
  out.writeUInt32LE(info.height, 4);
  data.copy(out, 8);
  const outPath = join(OUT_DIR, `capability-${slug}.rgba`);
  writeFileSync(outPath, out);
  console.log(`wrote ${outPath} (${out.length} bytes)`);
}
