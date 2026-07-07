import * as THREE from "three";

let dotTexture: THREE.CanvasTexture | null = null;

/** Soft round sprite so near points don't render as hard squares. */
export function getDotTexture(): THREE.CanvasTexture {
  if (!dotTexture) {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.5)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    dotTexture = new THREE.CanvasTexture(canvas);
  }
  return dotTexture;
}
