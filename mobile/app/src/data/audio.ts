import type { CapabilitySlug } from "@/data/registry";

export const AMBIENT_AUDIO_SOURCE = require("../../assets/audio/vorinthex-ambient.mp3");

export const CAPABILITY_BRIEFING_SOURCES: Record<CapabilitySlug, number> = {
  archive: require("../../assets/audio/capability-archive.mp3"),
  gallery: require("../../assets/audio/capability-gallery.mp3"),
  signal: require("../../assets/audio/capability-signal.mp3"),
  compass: require("../../assets/audio/capability-compass.mp3"),
  ascend: require("../../assets/audio/capability-ascend.mp3"),
};
