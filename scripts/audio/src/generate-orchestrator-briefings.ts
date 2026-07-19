import { spawn } from "node:child_process";
import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { loadAudioConfig } from "./config";
import { generateForTarget } from "./generate";
import { buildOrchestratorBriefingScript } from "./prompts";
import { AudioRegistryStore } from "./registry";
import { listTargets } from "./targets";

const BRIEFING_DURATION_SECONDS = 8;
const BRAND_VOICE = "Charon";

async function main(): Promise<void> {
  const config = await loadAudioConfig();
  const registry = new AudioRegistryStore(config.rootDir);
  const targets = listTargets().filter((target) => target.category === "orchestrator");
  const publicDir = path.resolve(config.rootDir, "../../web/app/public/audio/entities");

  for (const target of targets) {
    const prompt = buildOrchestratorBriefingScript(target);
    await generateForTarget(config, target, {
      prompt,
      duration: BRIEFING_DURATION_SECONDS,
      mode: "tts",
      // Gemini Flash TTS emits 24 kHz PCM; encode the public browser asset below.
      format: "pcm",
      voice: BRAND_VOICE,
    });

    const asset = (await registry.list()).find(
      (entry) => entry.slug === `orchestrator-${target.slug}`,
    );
    const version = asset?.versions.find((entry) => entry.id === asset.currentVersionId);
    if (version?.status !== "completed" || !version.audioPath) {
      throw new Error(`Briefing generation failed for ${target.slug}.`);
    }

    const publicPath = path.join(publicDir, `orchestrator-${target.slug}.mp3`);
    await mkdir(publicDir, { recursive: true });
    await encodePcmToMp3(path.join(config.rootDir, version.audioPath), publicPath);
    console.log(`Published ${target.slug} briefing.`);
  }
}

async function encodePcmToMp3(inputPath: string, outputPath: string): Promise<void> {
  const tempPath = `${outputPath}.${crypto.randomUUID()}.tmp.mp3`;
  const sourceDuration = (await stat(inputPath)).size / (24_000 * 2);
  const tempo = sourceDuration / BRIEFING_DURATION_SECONDS;
  await new Promise<void>((resolve, reject) => {
    const command = ffmpegStatic || "ffmpeg";
    const child = spawn(command, [
      "-y",
      "-f", "s16le",
      "-ar", "24000",
      "-ac", "1",
      "-i", inputPath,
      "-filter:a", `atempo=${tempo.toFixed(6)}`,
      "-codec:a", "libmp3lame",
      "-q:a", "2",
      tempPath,
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
