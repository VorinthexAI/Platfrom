import { z } from "zod";

import type { CapabilitySlug } from "./registry";

/**
 * Local mock data only — no backend, no network. Everything is validated
 * with Zod at module load so the shapes stay honest as the mockup evolves.
 */

const archiveItemSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  meta: z.string(),
});
export type ArchiveItem = z.infer<typeof archiveItemSchema>;

export const galleryVariantSchema = z.enum([
  "spire",
  "planet",
  "constellation",
  "arch",
  "crescent",
  "nebula",
]);
export type GalleryVariant = z.infer<typeof galleryVariantSchema>;

const galleryItemSchema = z.strictObject({
  id: z.string(),
  variant: galleryVariantSchema,
  seed: z.number().int(),
  collection: z.string().optional(),
  favorite: z.boolean(),
});
export type GalleryItem = z.infer<typeof galleryItemSchema>;

const signalItemSchema = z.strictObject({
  id: z.string(),
  sender: z.string(),
  subject: z.string(),
  time: z.string(),
  strength: z.number().min(0).max(1),
});
export type SignalItem = z.infer<typeof signalItemSchema>;

const compassItemSchema = z.strictObject({
  id: z.string(),
  place: z.string(),
  note: z.string(),
  kind: z.enum(["visited", "planned", "memory"]),
});
export type CompassItem = z.infer<typeof compassItemSchema>;

const ascendItemSchema = z.strictObject({
  id: z.string(),
  goal: z.string(),
  note: z.string(),
  progress: z.number().min(0).max(1),
});
export type AscendItem = z.infer<typeof ascendItemSchema>;

export const ARCHIVE_ITEMS: readonly ArchiveItem[] = z
  .array(archiveItemSchema)
  .parse([
    { id: "a1", title: "Project Phoenix Brief", meta: "Today, 9:41 PM" },
    { id: "a2", title: "Meeting Notes — Core Team", meta: "Yesterday, 4:21 PM" },
    { id: "a3", title: "Contract — Vorinthex AI", meta: "May 12, 2025" },
    { id: "a4", title: "Research — Neural Interfaces", meta: "May 4, 2025" },
    { id: "a5", title: "Reading List — Q3", meta: "April 28, 2025" },
  ]);

export const GALLERY_ITEMS: readonly GalleryItem[] = z
  .array(galleryItemSchema)
  .parse([
    { id: "g1", variant: "spire", seed: 11, collection: "Structures", favorite: true },
    { id: "g2", variant: "planet", seed: 23, collection: "Worlds", favorite: false },
    { id: "g3", variant: "constellation", seed: 37, favorite: true },
    { id: "g4", variant: "arch", seed: 41, collection: "Structures", favorite: false },
    { id: "g5", variant: "crescent", seed: 53, collection: "Worlds", favorite: false },
    { id: "g6", variant: "nebula", seed: 67, favorite: true },
  ]);

export const SIGNAL_ITEMS: readonly SignalItem[] = z
  .array(signalItemSchema)
  .parse([
    {
      id: "s1",
      sender: "Elena Voss",
      subject: "Term sheet — final redlines attached",
      time: "9:12 PM",
      strength: 0.95,
    },
    {
      id: "s2",
      sender: "Core Team",
      subject: "Launch review moved to Thursday",
      time: "6:48 PM",
      strength: 0.8,
    },
    {
      id: "s3",
      sender: "Dr. Amara Chen",
      subject: "Results from the second study",
      time: "2:05 PM",
      strength: 0.65,
    },
  ]);

/** Everything Signal held back today — surfaced as a single quiet line. */
export const SIGNAL_FILTERED_COUNT = 47;

export const COMPASS_ITEMS: readonly CompassItem[] = z
  .array(compassItemSchema)
  .parse([
    { id: "c1", place: "Kyoto, Japan", note: "Visited — April 2025", kind: "visited" },
    { id: "c2", place: "Reykjavík, Iceland", note: "Planned — December 2026", kind: "planned" },
    { id: "c3", place: "Lisbon, Portugal", note: "Memory — 12 photos", kind: "memory" },
    { id: "c4", place: "Patagonia, Chile", note: "Planned — next journey", kind: "planned" },
  ]);

export const ASCEND_ITEMS: readonly AscendItem[] = z
  .array(ascendItemSchema)
  .parse([
    { id: "p1", goal: "Morning routine", note: "21-day streak", progress: 0.7 },
    { id: "p2", goal: "Read 24 books", note: "14 of 24 complete", progress: 0.58 },
    { id: "p3", goal: "Learn Japanese", note: "Level 3 — 40 min today", progress: 0.35 },
    { id: "p4", goal: "Marathon base", note: "Week 6 of 16", progress: 0.38 },
  ]);

export type CapabilityContent = {
  archive: readonly ArchiveItem[];
  gallery: readonly GalleryItem[];
  signal: readonly SignalItem[];
  compass: readonly CompassItem[];
  ascend: readonly AscendItem[];
};

const CONTENT: CapabilityContent = {
  archive: ARCHIVE_ITEMS,
  gallery: GALLERY_ITEMS,
  signal: SIGNAL_ITEMS,
  compass: COMPASS_ITEMS,
  ascend: ASCEND_ITEMS,
};

/**
 * Future-ready server-state shape: capability screens read through
 * TanStack Query, but the "fetch" resolves locally. When the real API
 * exists, this swaps for the Axios client without touching the screens.
 */
export function fetchCapabilityContent<S extends CapabilitySlug>(
  slug: S,
): Promise<CapabilityContent[S]> {
  return Promise.resolve(CONTENT[slug]);
}

export const MOCK_USER = { firstName: "Oscar" } as const;

export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning,";
  if (hour >= 12 && hour < 18) return "Good afternoon,";
  return "Good evening,";
}
