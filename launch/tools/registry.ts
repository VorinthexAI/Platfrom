import { generateSlideshowTemplateTool } from "./genereate-slideshow-template";

export const LAUNCH_TOOLS_REGISTRY = {
  "generate.slidshow.template": {
    slug: "generate.slidshow.template",
    tool: generateSlideshowTemplateTool,
  },
} as const;

export type LaunchToolSlug = keyof typeof LAUNCH_TOOLS_REGISTRY;
export type LaunchToolRegistryEntry = typeof LAUNCH_TOOLS_REGISTRY[LaunchToolSlug];

export function selectLaunchTools(slugs: LaunchToolSlug[] = []): LaunchToolRegistryEntry[] {
  if (slugs.length === 0) return Object.values(LAUNCH_TOOLS_REGISTRY);
  return slugs.map((slug) => LAUNCH_TOOLS_REGISTRY[slug]);
}
