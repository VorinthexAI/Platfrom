import { slideshowDirectorAgentRuntime } from "./slideshow-director/agent";

export const LAUNCH_AGENTS_REGISTRY = {
  "Slideshow Director": slideshowDirectorAgentRuntime,
} as const;

export type LaunchAgentSlug = keyof typeof LAUNCH_AGENTS_REGISTRY;

export function selectLaunchAgents(slugs: LaunchAgentSlug[] = []) {
  if (slugs.length === 0) return Object.values(LAUNCH_AGENTS_REGISTRY);
  return slugs.map((slug) => LAUNCH_AGENTS_REGISTRY[slug]);
}
