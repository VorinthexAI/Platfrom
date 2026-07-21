import chalk from "chalk";
import { loadAudioConfig } from "./config";
import { ensureAudioRuntime } from "./filesystem";
import { generateForTarget } from "./generate";
import { mergeVideoAudio } from "./merge";
import { findTarget, listTargets } from "./targets";
import { audioCategorySchema, audioFormatSchema, audioModeSchema } from "./types";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "help";
  const config = await loadAudioConfig();
  await ensureAudioRuntime(config.rootDir);

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
    const mode = argValue("--mode") ? audioModeSchema.parse(argValue("--mode")) : undefined;
    const format = argValue("--format") ? audioFormatSchema.parse(argValue("--format")) : undefined;
    const videoPath = argValue("--video-path");
    const voice = argValue("--voice");
    const selectedTargets = hasArg("--all")
      ? listTargets()
      : [findTarget(audioCategorySchema.parse(argValue("--type")), String(argValue("--slug") ?? ""))]
          .filter((target): target is NonNullable<typeof target> => Boolean(target));

    if (selectedTargets.length === 0) throw new Error("No target found. Use --type and --slug, or --all.");
    for (const target of selectedTargets) {
      await generateForTarget(config, target, { prompt, variants, duration, mode, format, videoPath, voice });
    }
    return;
  }

  if (command === "tts") {
    const prompt = argValue("--prompt");
    const variants = argValue("--variants") ? Number(argValue("--variants")) : undefined;
    const duration = argValue("--duration") ? Number(argValue("--duration")) : undefined;
    const format = argValue("--format") ? audioFormatSchema.parse(argValue("--format")) : undefined;
    const voice = argValue("--voice") ?? config.voice;
    const type = audioCategorySchema.parse(argValue("--type") ?? "master-brand");
    const slug = argValue("--slug") ?? "vorinthex-ai";
    const target = findTarget(type, slug);

    if (!target) throw new Error("No target found. Use --type and --slug.");
    await generateForTarget(config, target, { prompt, variants, duration, mode: "tts", format, voice });
    return;
  }

  if (command === "merge") {
    const videoPath = argValue("--video");
    const audioPath = argValue("--audio");
    const outputPath = argValue("--output");
    if (!videoPath || !audioPath) throw new Error("Use --video <mp4> and --audio <audio-file>.");
    const mergedPath = await mergeVideoAudio({ videoPath, audioPath, outputPath });
    console.log(chalk.green(`Merged ${mergedPath}`));
    return;
  }

  console.log(chalk.bold("Vorinthex Audio Asset Engine"));
  console.log("Commands:");
  console.log("  bun run audio:list-targets");
  console.log("  bun run audio:generate -- --type master-brand --slug vorinthex-ai --duration 12");
  console.log("  bun run audio:tts -- --prompt \"Vorinthex AI is the nexus of intelligence.\"");
  console.log("  bun run audio:generate -- --type capability --slug archive --mode tts --prompt \"Voiceover text\"");
  console.log("  bun run audio:merge -- --video <video.mp4> --audio <audio.mp3>");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
