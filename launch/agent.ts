import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { LaunchAgentRuntime } from "./agents/schema";

type LoadedAgent = {
  name: string;
  agent: LaunchAgentRuntime;
};

const DEFAULT_HUNT_BASE_STYLE =
  "Vorinthex obsidian intelligence design system, premium dark AI galaxy, black obsidian background, " +
  "chrome and silver geometry, subtle cold metallic blue steel tint, high contrast, low clutter, " +
  "cinematic vertical 9:16 composition, orbital Nexus energy, polished crystal fragments, " +
  "sharp mythic technical atmosphere, no readable text, no watermark, ";

const DEFAULT_HUNT_SCENES = [
  "a lone explorer entering a vast obsidian galaxy gateway, silver fragments floating like intelligent stars",
  "asteroids opening in deep space to reveal giant chrome-lit crystals filled with intelligence fragments",
  "a precise orbital leaderboard structure rising around the Nexus, ranks shown as abstract silver tiers without text",
  "crystal fragments streaming into a central black-and-silver Nexus core, controlled metallic glow and deep negative space",
  "the galaxy watching from above as an explorer reaches toward the next fragment, premium launch campaign finale",
];

async function main(): Promise<void> {
  console.log("Loading launch agents...");
  const agents = await loadAgents();

  if (agents.length === 0) {
    console.log("No launch agents registered.");
    return;
  }

  console.log(`Loaded ${agents.length} launch agent${agents.length === 1 ? "" : "s"}.`);
  const selected = await selectAgent(agents);
  console.log(`Starting ${selected.name}...`);

  const toolNames = selected.agent.tools.map((entry) => entry.tool.name).join(", ");

  console.log("");
  console.log(`Success: ${selected.name} is ready.`);
  console.log(`Slug: ${selected.agent.slug}`);
  console.log(`Cadence: ${selected.agent.cadence}`);
  console.log(`Model: ${selected.agent.model}`);
  console.log(`Allowed tools: ${toolNames || "none"}`);
  console.log("");
  console.log(selected.agent.description);

  await runSelectedAgent(selected);
}

async function loadAgents(): Promise<LoadedAgent[]> {
  try {
    const { LAUNCH_AGENTS_REGISTRY } = await import("./agents/registry");
    return Object.entries(LAUNCH_AGENTS_REGISTRY).map(([name, agent]) => ({
      name,
      agent,
    }));
  } catch (error) {
    console.error("Error: failed to load launch agents.");
    throw error;
  }
}

async function selectAgent(agents: LoadedAgent[]): Promise<LoadedAgent> {
  const rl = createInterface({ input, output });
  try {
    console.log("Select launch agent:");
    agents.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.name}`);
    });

    while (true) {
      const answer = await rl.question(`Agent [1-${agents.length}]: `);
      const index = Number(answer.trim()) - 1;
      if (Number.isInteger(index) && agents[index]) return agents[index];
      console.log("Invalid selection.");
    }
  } finally {
    rl.close();
  }
}

async function runSelectedAgent(selected: LoadedAgent): Promise<void> {
  if (selected.agent.slug !== "slideshow.director") {
    console.log("");
    console.log(`No runner implemented for ${selected.name}.`);
    return;
  }

  const toolEntry = selected.agent.tools.find((entry) => entry.slug === "generate.slidshow.template");
  if (!toolEntry) throw new Error("Slideshow Director is missing generate.slidshow.template in allowed tools.");

  const rl = createInterface({ input, output });
  try {
    console.log("");
    console.log("Prepare slideshow generation.");
    console.log("Press Enter to use the default The Hunt slideshow.");

    const outputNameAnswer = await rl.question("Output label [the-hunt]: ");
    const baseStyleAnswer = await rl.question("Base style [Vorinthex obsidian intelligence]: ");

    console.log("Scenes: enter one scene per line. Submit an empty line to finish.");
    console.log("Leave the first scene empty to use the default The Hunt scenes.");
    const scenes: string[] = [];
    while (true) {
      const scene = await rl.question(`Scene ${scenes.length + 1}: `);
      if (!scene.trim()) break;
      scenes.push(scene.trim());
      if (scenes.length >= 20) break;
    }

    const payload = {
      outputName: outputNameAnswer.trim() || "the-hunt",
      baseStyle: baseStyleAnswer.trim() || DEFAULT_HUNT_BASE_STYLE,
      scenes: scenes.length > 0 ? scenes : DEFAULT_HUNT_SCENES,
      saveImages: true,
    };

    console.log("");
    console.log(`Generating ${payload.scenes.length} slides with ${selected.agent.model}...`);
    const startedAt = Date.now();
    const result = await toolEntry.tool.execute(payload);
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

    console.log("");
    console.log("Success: slideshow generated.");
    console.log(`Slides: ${result.slideCount}`);
    console.log(`Estimated cost: $${result.totalEstimatedCostUsd.toFixed(3)}`);
    console.log(`Output: ${result.outputDir ?? "not saved"}`);
    console.log(`Elapsed: ${elapsedSeconds}s`);
  } catch (error) {
    console.log("");
    console.error("Error: slideshow generation failed.");
    throw error;
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error("");
  console.error("Failed to run launch agent.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
