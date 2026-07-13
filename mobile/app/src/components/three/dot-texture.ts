import * as THREE from "three";

let dotTexture: THREE.DataTexture | null = null;

/**
 * Soft round point sprite, mirroring web/app's dot texture but built as a
 * DataTexture so it works without a DOM canvas on native.
 */
export function getDotTexture(): THREE.DataTexture {
  if (!dotTexture) {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
        const alpha = d >= 1 ? 0 : 1 - d;
        const i = (y * size + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.round(255 * alpha * alpha * (3 - 2 * alpha));
      }
    }
    dotTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    dotTexture.minFilter = THREE.LinearFilter;
    dotTexture.magFilter = THREE.LinearFilter;
    dotTexture.generateMipmaps = false;
    dotTexture.needsUpdate = true;
  }
  return dotTexture;
}
