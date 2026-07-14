import { Asset } from "expo-asset";
import { Platform } from "react-native";
import * as THREE from "three";

/**
 * Shared texture cache for the transparent capability logos (mobile port
 * of the web entity-logo.ts cache). One GPU texture per logo, reused by
 * every orbit ring and emblem.
 *
 * Native has no DOM <img>, so the PNG can't go through three's normal
 * ImageLoader. Instead the texture is flagged `isDataTexture`, which makes
 * three hand `image.data` verbatim to gl.texImage2D — and expo-gl accepts
 * an Expo Asset as that pixel source. (The exact trick expo-three's
 * TextureLoader uses, without taking the dependency.)
 */
const cache = new Map<number, THREE.Texture>();

export function getCapabilityLogoTexture(source: number): THREE.Texture {
  const cached = cache.get(source);
  if (cached) return cached;

  const texture = new THREE.Texture();
  texture.colorSpace = THREE.SRGBColorSpace;
  // NPOT-safe sampling — no mipmap generation on GLES.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  cache.set(source, texture);

  const asset = Asset.fromModule(source);
  asset
    .downloadAsync()
    .then(() => {
      if (Platform.OS === "web") {
        new THREE.ImageLoader().load(asset.uri, (image) => {
          texture.image = image;
          texture.needsUpdate = true;
        });
        return;
      }
      (texture as unknown as { isDataTexture: boolean }).isDataTexture = true;
      texture.image = {
        data: asset,
        width: asset.width ?? 1,
        height: asset.height ?? 1,
      };
      texture.needsUpdate = true;
    })
    .catch((error) => {
      console.warn("[entity-texture] logo load failed:", error);
    });

  return texture;
}
