import { Asset } from "expo-asset";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import * as THREE from "three";

/**
 * Shared texture cache for the transparent capability logos (mobile port
 * of the web entity-logo.ts cache). One texture per logo, reused by every
 * orbit ring and emblem.
 *
 * Web resolves like the web app does — TextureLoader-style image load.
 *
 * Native is the hard part. three r180 uploads through
 * texStorage2D/texSubImage2D, which only accept typed-array pixels, so
 * the old expo-three "Asset as isDataTexture image" trick yields an empty
 * texture. And an empty/incomplete texture samples OPAQUE BLACK on GLES —
 * that is the "black square around the planet". Injecting a hand-uploaded
 * GL texture into renderer.properties is no better: the injection lives
 * in one renderer's cache, so any GL context recreation or canvas remount
 * (routine on real phones) leaves the material bound to nothing — black
 * squares again.
 *
 * So expo-gl is used ONLY as a PNG decoder: upload the Asset once to a
 * scratch texture (texImage2D(..., asset) is the one upload expo-gl
 * documents), read the pixels back through a framebuffer, throw the
 * scratch away, and turn the shared texture into an honest DataTexture
 * with real bytes. From then on three owns the uploads — it re-uploads
 * after any context loss, on any renderer, with no private-cache hacks.
 */

type Entry = {
  texture: THREE.Texture;
  state: "idle" | "loading" | "ready";
  listeners: Set<() => void>;
};

const cache = new Map<number, Entry>();

function entryFor(source: number): Entry {
  let entry = cache.get(source);
  if (!entry) {
    const texture = new THREE.Texture();
    // NPOT-safe sampling — no mipmap generation on GLES.
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    entry = { texture, state: "idle", listeners: new Set() };
    cache.set(source, entry);
  }
  return entry;
}

function markReady(entry: Entry): void {
  entry.state = "ready";
  for (const listener of entry.listeners) listener();
}

async function loadWeb(entry: Entry, source: number): Promise<void> {
  const asset = Asset.fromModule(source);
  await asset.downloadAsync();
  entry.texture.colorSpace = THREE.SRGBColorSpace;
  new THREE.ImageLoader().load(asset.uri, (image) => {
    entry.texture.image = image;
    entry.texture.needsUpdate = true;
    markReady(entry);
  });
}

async function loadNative(
  entry: Entry,
  source: number,
  renderer: THREE.WebGLRenderer,
): Promise<void> {
  const asset = Asset.fromModule(source);
  await asset.downloadAsync();
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  if (!width || !height) throw new Error("asset has no dimensions");

  const gl = renderer.getContext();

  // Decode: park the PNG in a scratch GL texture... (bind through three's
  // state tracker so its binding cache stays truthful; state.reset() is
  // NOT an option — it reads gl.canvas.width, which doesn't exist on an
  // expo-gl context and throws.)
  const scratch = gl.createTexture();
  renderer.state.bindTexture(gl.TEXTURE_2D, scratch);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    asset as unknown as TexImageSource,
  );

  // ...and read the raw pixels back out through a framebuffer.
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    scratch,
    0,
  );
  const complete =
    gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  const pixels = new Uint8Array(width * height * 4);
  if (complete) {
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(framebuffer);
  gl.deleteTexture(scratch);
  renderer.state.bindTexture(gl.TEXTURE_2D, null);

  if (!complete) throw new Error("decode framebuffer incomplete");
  if (!pixels.some((value) => value !== 0)) {
    throw new Error("decoded logo is empty");
  }

  // Honest DataTexture: three's typed-array upload path works everywhere
  // and re-runs by itself whenever a context or renderer is recreated.
  const texture = entry.texture as THREE.Texture & { isDataTexture: boolean };
  texture.image = { data: pixels, width, height };
  texture.isDataTexture = true;
  // EXGL ignores UNPACK_FLIP_Y_WEBGL, so the rows land in GL order —
  // flip through the texture transform instead of the upload path.
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
export function useCapabilityLogoTexture(source: number): {
  texture: THREE.Texture;
  ready: boolean;
} {
  const renderer = useThree((state) => state.gl);
  const entry = useMemo(() => entryFor(source), [source]);
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
      Platform.OS === "web"
        ? loadWeb(entry, source)
        : loadNative(entry, source, renderer);
    load.catch((error) => {
      entry.state = "idle";
      console.warn("[entity-texture] logo load failed:", error);
    });
  }, [entry, renderer, source]);

  return { texture: entry.texture, ready };
}
