import chalk from "chalk";
import { loadVideoConfig } from "./config";
import { ensureVideoRuntime } from "./filesystem";
import { generateForTarget } from "./generate";
import { findTarget, listTargets } from "./targets";
import { aspectRatioSchema, resolutionSchema, videoCategorySchema } from "./types";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "help";
  const config = await loadVideoConfig();
  await ensureVideoRuntime(config.rootDir);

  if (command === "list-targets") {
    for (const target of listTargets()) {
      console.log(`${target.category}\t${target.slug}\t${target.name}`);
    }
    return;
  }

  if (command === "generate") {
    const prompt = argValue("--prompt");
    const variants = argValue("--variants") ? Number(argValue("--variants")) : undefined;
    const duration = argValue("--duration") ? Number(argValue("--duration")) : undefined;
    const resolution = argValue("--resolution") ? resolutionSchema.parse(argValue("--resolution")) : undefined;
    const aspectRatio = argValue("--aspect-ratio") ? aspectRatioSchema.parse(argValue("--aspect-ratio")) : undefined;
    const referenceImage = argValue("--reference-image");
    const generateAudio = hasArg("--no-audio") ? false : hasArg("--audio") ? true : undefined;
    const selectedTargets = hasArg("--all")
      ? listTargets()
      : [findTarget(videoCategorySchema.parse(argValue("--type")), String(argValue("--slug") ?? ""))]
          .filter((target): target is NonNullable<typeof target> => Boolean(target));

    if (selectedTargets.length === 0) throw new Error("No target found. Use --type and --slug, or --all.");
    for (const target of selectedTargets) {
      await generateForTarget(config, target, { prompt, variants, duration, resolution, aspectRatio, referenceImage, generateAudio });
    }
    return;
  }

  console.log(chalk.bold("Vorinthex Video Asset Engine"));
  console.log("Commands:");
  console.log("  bun run video:list-targets");
  console.log("  bun run video:generate -- --type product --slug core");
  console.log("  bun run video:generate -- --all");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
