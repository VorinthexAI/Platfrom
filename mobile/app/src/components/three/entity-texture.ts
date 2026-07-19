import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import { useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import * as THREE from "three";

import {
  capabilityIconSource,
  capabilityLogoDataSource,
} from "@/data/capability-icons";
import type { CapabilitySlug } from "@/data/registry";

/**
 * Shared texture cache for the transparent capability logos (mobile port
 * of the web entity-logo.ts cache). One texture per logo, reused by every
 * emblem in the galaxy.
 *
 * Web resolves like the web app does — TextureLoader-style image load.
 *
 * Native does NO image decoding at all. Every decode path on the device
 * has burned us: three r180 only uploads typed arrays (the expo-three
 * "Asset as image" trick yields an empty texture, which samples OPAQUE
 * BLACK on GLES — the "black square" bug), and expo-gl's own
 * texImage2D(asset) upload produced empty textures on real hardware while
 * working in the emulator. So the emblems ship as pre-baked raw RGBA
 * assets: uint32 LE width + height, then
 * pixel rows. The app reads the bytes with expo-file-system and hands
 * three a plain typed array — the one upload path that is identical on
 * every device, and that three re-uploads itself after any context loss.
 */

type Entry = {
  texture: THREE.Texture;
  state: "idle" | "loading" | "ready";
  listeners: Set<() => void>;
};

const cache = new Map<CapabilitySlug, Entry>();

function entryFor(slug: CapabilitySlug): Entry {
  let entry = cache.get(slug);
  if (!entry) {
    const texture = new THREE.Texture();
    // NPOT-safe sampling — no mipmap generation on GLES.
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    entry = { texture, state: "idle", listeners: new Set() };
    cache.set(slug, entry);
  }
  return entry;
}

function markReady(entry: Entry): void {
  entry.state = "ready";
  for (const listener of entry.listeners) listener();
}

async function loadWeb(entry: Entry, slug: CapabilitySlug): Promise<void> {
  const asset = Asset.fromModule(capabilityIconSource[slug] as number);
  await asset.downloadAsync();
  entry.texture.colorSpace = THREE.SRGBColorSpace;
  new THREE.ImageLoader().load(asset.uri, (image) => {
    entry.texture.image = image;
    entry.texture.needsUpdate = true;
    markReady(entry);
  });
}

async function loadNative(entry: Entry, slug: CapabilitySlug): Promise<void> {
  const asset = Asset.fromModule(capabilityLogoDataSource[slug]);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error("logo data asset has no localUri");

  const bytes = await new File(asset.localUri).bytes();
  if (bytes.byteLength < 8) throw new Error("logo data truncated");
  const header = new DataView(bytes.buffer, bytes.byteOffset, 8);
  const width = header.getUint32(0, true);
  const height = header.getUint32(4, true);
  if (bytes.byteLength !== 8 + width * height * 4) {
    throw new Error(`logo data size mismatch (${width}x${height})`);
  }
  const pixels = new Uint8Array(
    bytes.buffer,
    bytes.byteOffset + 8,
    width * height * 4,
  );

  // Honest DataTexture: three's typed-array upload path works everywhere
  // and re-runs by itself whenever a context or renderer is recreated.
  const texture = entry.texture as THREE.Texture & { isDataTexture: boolean };
  texture.image = { data: pixels, width, height };
  texture.isDataTexture = true;
  // Rows are stored top-first while GL expects bottom-first (and EXGL
  // ignores UNPACK_FLIP_Y_WEBGL) — flip through the texture transform.
  texture.repeat.y = -1;
  texture.offset.y = 1;
  texture.needsUpdate = true;
  markReady(entry);
}

/**
 * The capability's chrome ring emblem as a three texture. `ready` stays
 * false until real pixels exist — callers must not render the plane
 * before that: an incomplete texture samples opaque black on GLES, which
 * paints a black box instead of a logo.
 */
export function useCapabilityLogoTexture(slug: CapabilitySlug): {
  texture: THREE.Texture;
  ready: boolean;
} {
  const entry = useMemo(() => entryFor(slug), [slug]);
  const [ready, setReady] = useState(entry.state === "ready");

  useEffect(() => {
    const listener = () => setReady(entry.state === "ready");
    entry.listeners.add(listener);
    listener();
    return () => {
      entry.listeners.delete(listener);
    };
  }, [entry]);

  useEffect(() => {
    if (entry.state !== "idle") return;
    entry.state = "loading";
    const load =
      Platform.OS === "web" ? loadWeb(entry, slug) : loadNative(entry, slug);
    load.catch((error) => {
      entry.state = "idle";
      console.warn("[entity-texture] logo load failed:", error);
    });
  }, [entry, slug]);

  return { texture: entry.texture, ready };
}
