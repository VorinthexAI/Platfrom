import { z } from "zod";

export const capabilitySlugSchema = z.enum([
  "archive",
  "gallery",
  "signal",
  "compass",
  "ascend",
]);

export type CapabilitySlug = z.infer<typeof capabilitySlugSchema>;

const capabilitySchema = z.strictObject({
  slug: capabilitySlugSchema,
  name: z.string().min(1),
  /** Tagline under the hero icon on the capability screen. */
  tagline: z.string().min(1),
  searchPlaceholder: z.string().min(1),
  /** Uppercase micro-label above the capability's content list (omitted where the mockup shows none). */
  sectionLabel: z.string().min(1).optional(),
});

export type Capability = z.infer<typeof capabilitySchema>;

const registrySchema = z.array(capabilitySchema).length(5);

export const CAPABILITIES: readonly Capability[] = registrySchema.parse([
  {
    slug: "archive",
    name: "Archive",
    tagline: "Your intelligent archive\nthat remembers everything.",
    searchPlaceholder: "Search archive...",
    sectionLabel: "Recent items",
  },
  {
    slug: "gallery",
    name: "Gallery",
    tagline: "Create, collect and curate\nimages that inspire you.",
    searchPlaceholder: "Search gallery...",
  },
  {
    slug: "signal",
    name: "Signal",
    tagline: "Only what matters\nreaches you.",
    searchPlaceholder: "Search signal...",
    sectionLabel: "Priority",
  },
  {
    slug: "compass",
    name: "Compass",
    tagline: "Your saved cities,\nmapped with clarity.",
    searchPlaceholder: "Search countries...",
    sectionLabel: "Saved cities",
  },
  {
    slug: "ascend",
    name: "Ascend",
    tagline: "Build the person\nyou are becoming.",
    searchPlaceholder: "Search ascend...",
    sectionLabel: "Active goals",
  },
]);

export function getCapability(slug: CapabilitySlug): Capability {
  const capability = CAPABILITIES.find((entry) => entry.slug === slug);
  if (!capability) {
    throw new Error(`Unknown capability: ${slug}`);
  }
  return capability;
}
