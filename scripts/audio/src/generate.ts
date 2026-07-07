import { mkdir } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { nanoid } from "nanoid";
import { atomicWrite, ensureAudioRuntime } from "./filesystem";
import { OpenRouterAudioClient } from "./openrouter";
import { buildAudioPrompt, buildDefaultVoiceoverScript } from "./prompts";
import { AudioRegistryStore } from "./registry";
import type { AudioConfig, AudioFormat, AudioMode } from "./types";
import { hashText, rel } from "./utils";
import type { AudioTarget } from "./targets";

export async function generateForTarget(config: AudioConfig, target: AudioTarget, options: {
  prompt?: string;
  variants?: number;
  duration?: number;
  mode?: AudioMode;
  format?: AudioFormat;
  videoPath?: string;
  voice?: string;
}): Promise<void> {
  await ensureAudioRuntime(config.rootDir);
  const registry = new AudioRegistryStore(config.rootDir);
  const client = new OpenRouterAudioClient(config);
  const asset = await registry.createAsset({
    slug: `${target.category}-${target.slug}`,
    name: target.name,
    category: target.category,
    entityId: target.entityId,
    description: target.description
  });

  const variants = options.variants ?? config.variants;
  const mode = options.mode ?? config.mode;
  const format = options.format ?? config.format;
  const duration = options.duration ?? config.duration;
  const model = mode === "tts" ? config.ttsModel : config.model;

  for (let index = 0; index < variants; index += 1) {
    const nextNumber = Math.max(0, ...asset.versions.map((version) => version.version)) + 1;
    const versionId = `v${nextNumber}`;
    const runId = nanoid(12);
    const outputDir = path.join(config.rootDir, "outputs/audio", target.category, target.slug, versionId);
    const runDir = path.join(config.rootDir, "runs", runId);
    await mkdir(outputDir, { recursive: true });
    await mkdir(runDir, { recursive: true });

    const fullPrompt = buildAudioPrompt(config, target, { mode, duration, extraPrompt: options.prompt, videoPath: options.videoPath });
    const promptPath = path.join(outputDir, "prompt.md");
    const audioPath = path.join(outputDir, `${target.slug}-${versionId}.${format}`);
    const metadataPath = path.join(outputDir, "metadata.json");
    await atomicWrite(promptPath, fullPrompt);

    console.log(chalk.cyan(`Generating audio ${target.category}/${target.slug} ${versionId} (${mode})`));
    try {
      const speechInput = options.prompt || buildDefaultVoiceoverScript(target);
      const audio = mode === "tts"
        ? await client.generateSpeech({ model, input: speechInput, voice: options.voice ?? config.voice, format })
        : await client.generateSoundtrack({ model, prompt: fullPrompt, format });
      await atomicWrite(audioPath, audio);

      const metadata = {
        runId,
        target,
        provider: "openrouter",
        model,
        mode,
        duration,
        format,
        voice: mode === "tts" ? options.voice ?? config.voice : undefined,
        language: mode === "tts" ? "en" : undefined,
        speechInput: mode === "tts" ? speechInput : undefined,
        bpm: config.bpm,
        promptHash: hashText(fullPrompt),
        promptPath: rel(config.rootDir, promptPath),
        audioPath: rel(config.rootDir, audioPath),
        videoPath: options.videoPath,
        createdAt: new Date().toISOString()
      };
      await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
      await registry.addVersion(asset, {
        prompt: options.prompt ?? "",
        fullPrompt,
        mode,
        model,
        voice: mode === "tts" ? options.voice ?? config.voice : undefined,
        language: mode === "tts" ? "en" : undefined,
        duration,
        format,
        status: "completed",
        audioPath: metadata.audioPath,
        metadataPath: rel(config.rootDir, metadataPath)
      });
      console.log(chalk.green(`Generated ${metadata.audioPath}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await atomicWrite(metadataPath, `${JSON.stringify({ runId, target, status: "failed", error: message, createdAt: new Date().toISOString() }, null, 2)}\n`);
      await registry.addVersion(asset, {
        prompt: options.prompt ?? "",
        fullPrompt,
        mode,
        model,
        duration,
        format,
        status: "failed",
        metadataPath: rel(config.rootDir, metadataPath),
        error: message
      });
      console.error(chalk.red(`Failed ${target.slug}: ${message}`));
    }
  }
}
