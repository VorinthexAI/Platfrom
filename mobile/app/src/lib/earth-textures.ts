import * as THREE from "three";

import {
  EARTH_ELEVATION_HEIGHT,
  EARTH_ELEVATION_RGBA_BASE64,
  EARTH_ELEVATION_WIDTH,
  EARTH_SURFACE_HEIGHT,
  EARTH_SURFACE_RGBA_BASE64,
  EARTH_SURFACE_WIDTH,
} from "@/data/earth-textures.generated";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const decodeTable = new Int16Array(128).fill(-1);
for (let index = 0; index < alphabet.length; index += 1) decodeTable[alphabet.charCodeAt(index)] = index;

export function decodeBase64Bytes(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array(value.length / 4 * 3 - padding);
  let output = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = decodeTable[value.charCodeAt(index)] ?? -1;
    const b = decodeTable[value.charCodeAt(index + 1)] ?? -1;
    const c = value[index + 2] === "=" ? 0 : decodeTable[value.charCodeAt(index + 2)] ?? -1;
    const d = value[index + 3] === "=" ? 0 : decodeTable[value.charCodeAt(index + 3)] ?? -1;
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error("Earth texture data is not valid base64.");
    const packed = a << 18 | b << 12 | c << 6 | d;
    if (output < bytes.length) bytes[output++] = packed >> 16 & 255;
    if (output < bytes.length) bytes[output++] = packed >> 8 & 255;
    if (output < bytes.length) bytes[output++] = packed & 255;
  }
  return bytes;
}

function texture(bytes: Uint8Array, width: number, height: number, color = false) {
  const value = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  value.flipY = true;
  value.wrapS = THREE.RepeatWrapping;
  value.wrapT = THREE.ClampToEdgeWrapping;
  // Globe coordinates use +Z at longitude 0; SphereGeometry's UV seam is 90 degrees west of that axis.
  value.offset.x = 0.25;
  value.magFilter = THREE.LinearFilter;
  value.minFilter = THREE.LinearMipmapLinearFilter;
  value.generateMipmaps = true;
  value.anisotropy = 4;
  if (color) value.colorSpace = THREE.SRGBColorSpace;
  value.needsUpdate = true;
  return value;
}

export function createEarthTextures() {
  return {
    surface: texture(decodeBase64Bytes(EARTH_SURFACE_RGBA_BASE64), EARTH_SURFACE_WIDTH, EARTH_SURFACE_HEIGHT, true),
    elevation: texture(decodeBase64Bytes(EARTH_ELEVATION_RGBA_BASE64), EARTH_ELEVATION_WIDTH, EARTH_ELEVATION_HEIGHT),
  };
}
