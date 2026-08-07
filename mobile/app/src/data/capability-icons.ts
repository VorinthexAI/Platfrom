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
