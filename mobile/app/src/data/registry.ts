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
  /** Two-to-three-line onboarding card copy, verbatim from the approved mockup. */
  onboardingDescription: z.string().min(1),
  /** Tagline under the hero icon on the capability screen. */
  tagline: z.string().min(1),
  searchPlaceholder: z.string().min(1),
  /** Uppercase micro-label above the capability's content list (omitted where the mockup shows none). */
  sectionLabel: z.string().min(1).optional(),
});

export type Capability = z.infer<typeof capabilitySchema>;

const registrySchema = z.array(capabilitySchema).length(5);

/** Onboarding order is fixed: Archive, Gallery, Signal, Compass, Ascend. */
export const CAPABILITIES: readonly Capability[] = registrySchema.parse([
  {
    slug: "archive",
    name: "Archive",
    onboardingDescription:
      "Store, organize and retrieve everything that matters.",
    tagline: "Your intelligent archive\nthat remembers everything.",
    searchPlaceholder: "Search archive...",
    sectionLabel: "Recent items",
  },
  {
    slug: "gallery",
    name: "Gallery",
    onboardingDescription:
      "Generate, collect and curate images and visual inspiration.",
    tagline: "Create, collect and curate\nimages that inspire you.",
    searchPlaceholder: "Search gallery...",
  },
  {
    slug: "signal",
    name: "Signal",
    onboardingDescription:
      "Stay updated with real-time insights and important signals.",
    tagline: "Only what matters\nreaches you.",
    searchPlaceholder: "Search signal...",
    sectionLabel: "Priority",
  },
  {
    slug: "compass",
    name: "Compass",
    onboardingDescription:
      "Navigate decisions with clarity and directional guidance.",
    tagline: "Your places, memories and\njourneys, mapped with clarity.",
    searchPlaceholder: "Search compass...",
    sectionLabel: "Places & journeys",
  },
  {
    slug: "ascend",
    name: "Ascend",
    onboardingDescription:
      "Evolve continuously and unlock your highest potential.",
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
