import { mkdir, rename, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { loadAudioConfig } from "./config";
import { generateForTarget } from "./generate";
import { buildEntityBriefingScript } from "./prompts";
import { AudioRegistryStore } from "./registry";
import { listTargets } from "./targets";

const CATEGORIES = new Set(["product", "capability", "orchestrator"]);
const BRIEFING_DURATION_SECONDS = 12;

async function main(): Promise<void> {
  const config = await loadAudioConfig();
  const registry = new AudioRegistryStore(config.rootDir);
  const publicDir = path.resolve(config.rootDir, "../../web/app/public/audio/entities");
  const targets = listTargets().filter((target) => CATEGORIES.has(target.category));

  await mkdir(publicDir, { recursive: true });
  for (const target of targets) {
    await generateForTarget(config, target, {
      prompt: buildEntityBriefingScript(target),
      duration: BRIEFING_DURATION_SECONDS,
      mode: "tts",
      format: "pcm",
      voice: "Charon",
    });

    const asset = (await registry.list()).find((entry) => entry.slug === `${target.category}-${target.slug}`);
    const version = asset?.versions.find((entry) => entry.id === asset.currentVersionId);
    if (version?.status !== "completed" || !version.audioPath) {
      throw new Error(`Briefing generation failed for ${target.category}/${target.slug}.`);
    }

    const sourcePath = path.join(config.rootDir, version.audioPath);
    const publicPath = path.join(publicDir, `${target.category}-${target.slug}.mp3`);
    await encodePcmToMp3(sourcePath, publicPath);
    console.log(`Published ${publicPath}`);
  }
}

async function encodePcmToMp3(inputPath: string, outputPath: string): Promise<void> {
  const tempPath = `${outputPath}.${crypto.randomUUID()}.tmp.mp3`;
  const sourceDuration = (await stat(inputPath)).size / (24_000 * 2);
  const tempo = sourceDuration / BRIEFING_DURATION_SECONDS;
  await new Promise<void>((resolve, reject) => {
    const command = ffmpegStatic || "ffmpeg";
    const child = spawn(command, [
      "-y", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", inputPath,
       "-filter:a", buildTempoFilter(tempo),
      "-codec:a", "libmp3lame", "-q:a", "2", tempPath,
    ], { stdio: "inherit", shell: command === "ffmpeg" && process.platform === "win32" });
    child.on("error", reject);
    child.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg failed with exit code ${code}.`));
        return;
      }
      await rename(tempPath, outputPath);
      resolve();
    });
  });
}

function buildTempoFilter(tempo: number): string {
  const filters: string[] = [];
  let remaining = tempo;
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters.join(",");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
