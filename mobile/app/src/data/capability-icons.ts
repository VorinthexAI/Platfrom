import type { ImageSource } from "expo-image";

import type { CapabilitySlug } from "./registry";

/**
 * Approved chrome capability icons, copied from web/app/public/logos/entities.
 * Transparent PNGs — never redrawn, never substituted.
 */
export const capabilityIconSource: Record<CapabilitySlug, ImageSource> = {
  archive: require("../../assets/brand/capability-archive.png"),
  gallery: require("../../assets/brand/capability-gallery.png"),
  signal: require("../../assets/brand/capability-signal.png"),
  compass: require("../../assets/brand/capability-compass.png"),
  ascend: require("../../assets/brand/capability-ascend.png"),
};

/** The real Vorinthex mark from web/app/public/logos. */
export const vorinthexMarkSource: ImageSource = require("../../assets/brand/vorinthex-mark.png");

/**
 * The same emblems pre-baked to raw RGBA bytes (scripts/image logo:rgba)
 * for the 3D galaxy: on-device image decoding through expo-gl produced
 * empty textures on real hardware, so the planet emblems bypass image
 * decoding entirely. Format: uint32 LE width + height, then RGBA rows.
 */
export const capabilityLogoDataSource: Record<CapabilitySlug, number> = {
  archive: require("../../assets/brand/logo-data/capability-archive.rgba"),
  gallery: require("../../assets/brand/logo-data/capability-gallery.rgba"),
  signal: require("../../assets/brand/logo-data/capability-signal.rgba"),
  compass: require("../../assets/brand/logo-data/capability-compass.rgba"),
  ascend: require("../../assets/brand/logo-data/capability-ascend.rgba"),
};
