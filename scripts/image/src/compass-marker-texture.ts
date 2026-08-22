import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const sourcePath = join(import.meta.dir, "../../../mobile/app/assets/brand/capability-compass.png");
const outputPath = join(import.meta.dir, "../../../mobile/app/src/data/compass-marker-texture.generated.ts");
const size = 64;
const { data, info } = await sharp(readFileSync(sourcePath))
  .resize(size, size, { fit: "cover" })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

if (info.width !== size || info.height !== size || info.channels !== 4) {
  throw new Error(`Unexpected Compass marker output: ${JSON.stringify(info)}`);
}

writeFileSync(outputPath, [
  "// Generated from mobile/app/assets/brand/capability-compass.png.",
  `export const COMPASS_MARKER_SIZE = ${size};`,
  `export const COMPASS_MARKER_RGBA_BASE64 = ${JSON.stringify(data.toString("base64"))};`,
  "",
].join("\n"));

console.log(`wrote ${outputPath}`);
