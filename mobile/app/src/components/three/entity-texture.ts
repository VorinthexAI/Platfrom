import { Asset } from "expo-asset";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Platform } from "react-native";
import * as THREE from "three";

/**
 * Shared texture cache for the transparent capability logos (mobile port
 * of the web entity-logo.ts cache). One GPU texture per logo, reused by
 * every orbit ring and emblem.
 *
 * Web resolves like the web app does — TextureLoader-style image load.
 *
 * Native cannot go through three's upload machinery at all: three r180
 * uploads via texStorage2D/texSubImage2D, which only accept typed-array
 * pixels, so the old expo-three "isDataTexture with an Asset as image"
 * trick silently produces an empty texture (planets rendered with NO logo
 * on device). Instead we use the one upload path expo-gl documents —
 * texImage2D(target, level, RGBA, RGBA, UNSIGNED_BYTE, asset) — on the
 * raw context, then hand the finished GL texture to three through
 * renderer.properties. three keeps texture.version at 0 and simply binds
 * what we injected.
 */

type Entry = {
  texture: THREE.Texture;
  state: "idle" | "loading" | "ready";
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
    entry = { texture, state: "idle" };
    cache.set(source, entry);
  }
  return entry;
}

async function loadWeb(entry: Entry, source: number): Promise<void> {
  const asset = Asset.fromModule(source);
  await asset.downloadAsync();
  entry.texture.colorSpace = THREE.SRGBColorSpace;
  new THREE.ImageLoader().load(asset.uri, (image) => {
    entry.texture.image = image;
    entry.texture.needsUpdate = true;
    entry.state = "ready";
  });
}

async function loadNative(
  entry: Entry,
  source: number,
  renderer: THREE.WebGLRenderer,
): Promise<void> {
  const asset = Asset.fromModule(source);
  await asset.downloadAsync();

  const gl = renderer.getContext();
  const glTexture = gl.createTexture();
  // Bind through three's state tracker so its binding cache stays truthful
  // (a raw gl.bindTexture would leave three believing something else is
  // bound; state.reset() is NOT an option — it reads gl.canvas.width,
  // which doesn't exist on an expo-gl context and throws).
  renderer.state.bindTexture(gl.TEXTURE_2D, glTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    asset as unknown as TexImageSource,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  renderer.state.bindTexture(gl.TEXTURE_2D, null);

  // Adopt the finished GL texture: with version 0 three never tries to
  // upload, it just binds __webglTexture wherever the map is sampled.
  const properties = renderer.properties.get(entry.texture) as {
    __webglTexture?: WebGLTexture | null;
    __webglInit?: boolean;
  };
  properties.__webglTexture = glTexture;
  properties.__webglInit = true;
  // EXGL ignores UNPACK_FLIP_Y_WEBGL ("doesn't support this parameter
  // yet"), so the upload lands unflipped for three's UV convention —
  // flip through the texture transform instead of the upload path.
  entry.texture.repeat.y = -1;
  entry.texture.offset.y = 1;
  entry.state = "ready";
}

/**
 * The capability's chrome ring emblem as a three texture, ready to bind.
 * Must be used inside the galaxy Canvas (the GL texture lives on that
 * context). Until loaded it samples transparent black — invisible.
 */
export function useCapabilityLogoTexture(source: number): THREE.Texture {
  const renderer = useThree((state) => state.gl);
  const entry = useMemo(() => entryFor(source), [source]);

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

  return entry.texture;
}
