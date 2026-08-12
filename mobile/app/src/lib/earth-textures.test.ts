import { describe, expect, test } from "bun:test";

import { decodeBase64Bytes } from "./earth-textures";
import {
  EARTH_ELEVATION_HEIGHT,
  EARTH_ELEVATION_RGBA_BASE64,
  EARTH_ELEVATION_WIDTH,
  EARTH_SURFACE_HEIGHT,
  EARTH_SURFACE_RGBA_BASE64,
  EARTH_SURFACE_WIDTH,
} from "@/data/earth-textures.generated";

describe("Earth texture data", () => {
  test("decodes standard padded base64 bytes without native image APIs", () => {
    expect([...decodeBase64Bytes("AAECAwQ=" )]).toEqual([0, 1, 2, 3, 4]);
  });

  test("rejects malformed texture data", () => {
    expect(() => decodeBase64Bytes("!!!!")).toThrow();
  });

  test("contains complete RGBA surface and elevation rasters", () => {
    expect(decodeBase64Bytes(EARTH_SURFACE_RGBA_BASE64)).toHaveLength(EARTH_SURFACE_WIDTH * EARTH_SURFACE_HEIGHT * 4);
    expect(decodeBase64Bytes(EARTH_ELEVATION_RGBA_BASE64)).toHaveLength(EARTH_ELEVATION_WIDTH * EARTH_ELEVATION_HEIGHT * 4);
  });
});
