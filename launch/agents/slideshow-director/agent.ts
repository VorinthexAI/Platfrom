import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LaunchAgentSettingsSchema,
  createLaunchAgentRuntime,
  type LaunchAgentRuntime,
  type LaunchAgentSettings,
} from "../schema";

const AGENT_DIR = import.meta.dir;
const skill = readFileSync(path.join(AGENT_DIR, "SKILL.md"), "utf8");

export const slideshowDirectorAgentSettings: LaunchAgentSettings = LaunchAgentSettingsSchema.parse({
  slug: "slideshow.director",
  name: "Slideshow Director",
  description: "Creates consistent vertical launch slideshow assets from campaign briefs and scene plans.",
  cadence: "manual",
  allowedTools: ["generate.slidshow.template"],
  skill,
  model: "gpt-image-2",
  temperature: 0.4,
  maxIterations: 4,
});

export const slideshowDirectorAgentRuntime: LaunchAgentRuntime = createLaunchAgentRuntime(
  slideshowDirectorAgentSettings,
);
