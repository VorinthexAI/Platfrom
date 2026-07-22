import * as THREE from "three";

/**
 * Shared texture cache for the transparent entity logos in
 * /public/logos/entities (assets are baked into the web app's public
 * folder, never read from scripts/). One GPU texture per entity, reused
 * by planet rings, moon rings, and interior emblems.
 */

const cache = new Map<string, THREE.Texture>();

export function entityLogoUrl(type: string, slug: string): string {
  if (type === "star") {
    return "/logos/vorinthex-mark.png";
  }
  if (type === "product" && ["hq", "replica", "pilot"].includes(slug)) {
    return `/logos/entities/${type}-${slug}-transparent.png`;
  }
  return `/logos/entities/${type}-${slug}.png`;
}

export function getEntityLogoTexture(type: string, slug: string): THREE.Texture {
  const url = entityLogoUrl(type, slug);
  const cached = cache.get(url);
  if (cached) return cached;
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  cache.set(url, texture);
  return texture;
}
