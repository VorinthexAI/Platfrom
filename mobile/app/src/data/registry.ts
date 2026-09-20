import { z } from "zod";

export const capabilitySlugSchema = z.enum([
  "archive",
  "gallery",
  "signal",
  "compass",
  "ascend",
  "hq",
]);

export type CapabilitySlug = z.infer<typeof capabilitySlugSchema>;

export const PUBLIC_WORKSPACE_SLUGS = ["archive", "gallery", "compass", "signal", "ascend"] as const satisfies readonly CapabilitySlug[];

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

const registrySchema = z.array(capabilitySchema).length(6);

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
    tagline: "Your private inbox for email\nand Vorinthex communication.",
    searchPlaceholder: "Search Signal...",
    sectionLabel: "Inbox",
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
  {
    slug: "hq",
    name: "HQ",
    tagline: "Your workspace to manage\nteams and collaboration.",
    searchPlaceholder: "Search HQ...",
  },
]);

export function getCapability(slug: CapabilitySlug): Capability {
  const capability = CAPABILITIES.find((entry) => entry.slug === slug);
  if (!capability) {
    throw new Error(`Unknown capability: ${slug}`);
  }
  return capability;
}

export function workspaceSlugsForMember(_rootTeamMember = false): CapabilitySlug[] {
  return [...PUBLIC_WORKSPACE_SLUGS];
}

export type WorkspacePickerApp = {
  scopeKey: string;
  slug: string;
  name: string;
};

export type WorkspacePickerState = {
  apps: WorkspacePickerApp[];
  selectedScopeKeys: string[] | null;
};

export const emptyWorkspacePicker: WorkspacePickerState = { apps: [], selectedScopeKeys: null };

function asCapabilitySlug(slug: string): CapabilitySlug | null {
  const parsed = capabilitySlugSchema.safeParse(slug);
  return parsed.success ? parsed.data : null;
}

export function entitledPickerApps(picker: WorkspacePickerState, rootTeamMember = false): Array<WorkspacePickerApp & { slug: CapabilitySlug }> {
  const apps = picker.apps.flatMap((app) => {
    const slug = asCapabilitySlug(app.slug);
    return slug && slug !== "hq" ? [{ ...app, slug }] : [];
  });
  if (apps.length) return apps;
  return workspaceSlugsForMember(rootTeamMember).map((slug) => ({ scopeKey: "", slug, name: getCapability(slug).name }));
}

export function visibleWorkspaceSlugs(picker: WorkspacePickerState, rootTeamMember: boolean): CapabilitySlug[] {
  const entitled = entitledPickerApps(picker, rootTeamMember);
  if (!picker.selectedScopeKeys) return entitled.map(({ slug }) => slug);
  const selected = entitled.filter((app) => picker.selectedScopeKeys!.includes(app.scopeKey));
  return (selected.length ? selected : entitled).map(({ slug }) => slug);
}
