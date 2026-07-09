import { z } from "zod";
import { LAUNCH_TOOLS_REGISTRY, selectLaunchTools, type LaunchToolSlug } from "../tools/registry";

const launchToolSlugs = Object.keys(LAUNCH_TOOLS_REGISTRY) as LaunchToolSlug[];

export const AgentCadenceSchema = z.enum([
  "manual",
  "once",
  "daily",
  "weekly",
  "event_driven",
]);

export const LaunchToolSlugSchema = z.custom<LaunchToolSlug>(
  (value) => typeof value === "string" && launchToolSlugs.includes(value as LaunchToolSlug),
  "Unknown launch tool slug.",
);

export const LaunchAgentSettingsSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  cadence: AgentCadenceSchema,
  allowedTools: z.array(LaunchToolSlugSchema),
  skill: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxIterations: z.number().int().positive(),
});

export type AgentCadence = z.infer<typeof AgentCadenceSchema>;
export type LaunchAgentSettings = z.infer<typeof LaunchAgentSettingsSchema>;

export type LaunchAgentRuntime = LaunchAgentSettings & {
  tools: ReturnType<typeof selectLaunchTools>;
};

export function createLaunchAgentRuntime(settings: LaunchAgentSettings): LaunchAgentRuntime {
  return {
    ...settings,
    tools: selectLaunchTools(settings.allowedTools),
  };
}
