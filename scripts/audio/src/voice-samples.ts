import { mkdir } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { nanoid } from "nanoid";
import { loadAudioConfig } from "./config";
import { atomicWrite, ensureAudioRuntime } from "./filesystem";
import { OpenRouterAudioClient } from "./openrouter";
import { AudioRegistryStore } from "./registry";
import type { AudioConfig, AudioFormat } from "./types";
import { hashText, rel, slugify } from "./utils";
import type { AudioTarget } from "./targets";

const speechInput = "Welcome to the Vorinthex galaxy. This is the hunt: collect Intelligence Fragments scattered across the galaxy, and climb the ranks. Dive into asteroids to uncover giant crystals worth thousands of fragments. The higher you stand at launch, the greater your prizes, offers, and early access. Every fragment feeds the Nexus. Keep exploring. The galaxy is watching.";

const target: AudioTarget = {
  slug: "vorinthex-ai",
  name: "Vorinthex AI",
  category: "master-brand",
  entityId: "brand.vorinthex-ai",
  description: "Vorinthex AI master brand: The Nexus of Intelligence."
};

type VoiceGender = "female" | "male";

type VoiceSample = {
  model: string;
  modelLabel: string;
  voice: string;
  gender: VoiceGender;
  format: AudioFormat;
  playableFormat?: AudioFormat;
};

const googleVoices: Array<Omit<VoiceSample, "model" | "modelLabel" | "format" | "playableFormat">> = [
  { voice: "Zephyr", gender: "female" },
  { voice: "Puck", gender: "male" },
  { voice: "Charon", gender: "male" },
  { voice: "Kore", gender: "female" },
  { voice: "Fenrir", gender: "male" },
  { voice: "Leda", gender: "female" },
  { voice: "Orus", gender: "male" },
  { voice: "Aoede", gender: "female" },
  { voice: "Callirrhoe", gender: "female" },
  { voice: "Autonoe", gender: "female" },
  { voice: "Enceladus", gender: "male" },
  { voice: "Iapetus", gender: "male" },
  { voice: "Umbriel", gender: "male" },
  { voice: "Algieba", gender: "male" },
  { voice: "Despina", gender: "female" },
  { voice: "Erinome", gender: "female" },
  { voice: "Algenib", gender: "male" },
  { voice: "Rasalgethi", gender: "male" },
  { voice: "Laomedeia", gender: "female" },
  { voice: "Achernar", gender: "female" },
  { voice: "Alnilam", gender: "male" },
  { voice: "Schedar", gender: "male" },
  { voice: "Gacrux", gender: "female" },
  { voice: "Pulcherrima", gender: "female" },
  { voice: "Achird", gender: "male" },
  { voice: "Zubenelgenubi", gender: "male" },
  { voice: "Vindemiatrix", gender: "female" },
  { voice: "Sadachbia", gender: "male" },
  { voice: "Sadaltager", gender: "male" },
  { voice: "Sulafat", gender: "female" }
];

const kokoroVoices = [
  "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa",
  "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
  "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
  "ef_dora", "em_alex", "em_santa",
  "ff_siwis",
  "hf_alpha", "hf_beta", "hm_omega", "hm_psi",
  "if_sara", "im_nicola",
  "jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo",
  "pf_dora", "pm_alex", "pm_santa",
  "zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi",
  "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang"
];

const samples: VoiceSample[] = [
  ...googleVoices.map((entry) => ({
    ...entry,
    model: "google/gemini-3.1-flash-tts-preview",
    modelLabel: "Google Gemini 3.1 Flash TTS",
    format: "pcm" as const,
    playableFormat: "wav" as const
  })),
  ...kokoroVoices.map((voice) => ({
    model: "hexgrad/kokoro-82m",
    modelLabel: "Kokoro 82M",
    voice,
    gender: voice[1] === "m" ? "male" as const : "female" as const,
    format: "mp3" as const
  }))
];

async function main(): Promise<void> {
  const config = await loadAudioConfig();
  await ensureAudioRuntime(config.rootDir);
  const registry = new AudioRegistryStore(config.rootDir);
  const client = new OpenRouterAudioClient(config);
  let completed = 0;
  let skipped = 0;
  let failed = 0;

  for (const sample of samples) {
    const modelSlug = slugify(sample.model.replace("/", "-"));
    const voiceSlug = slugify(sample.voice);
    const asset = await registry.createAsset({
      slug: `voice-${modelSlug}-${voiceSlug}`,
      name: `${sample.modelLabel} - ${sample.voice}`,
      category: "master-brand",
      entityId: target.entityId,
      description: `Voice sample for ${sample.modelLabel}. Gender: ${sample.gender}.`
    });

    if (asset.versions.some((version) => version.status === "completed" && version.model === sample.model && version.voice === sample.voice)) {
      skipped += 1;
      continue;
    }

    const versionId = `v${Math.max(0, ...asset.versions.map((version) => version.version)) + 1}`;
    const runId = nanoid(12);
    const outputDir = path.join(config.rootDir, "outputs/audio/voices", modelSlug, voiceSlug, versionId);
    await mkdir(outputDir, { recursive: true });

    const fullPrompt = [
      `Create a voice sample for ${sample.modelLabel}.`,
      "",
      `Model: ${sample.model}`,
      `Voice: ${sample.voice}`,
      `Gender: ${sample.gender}`,
      "",
      speechInput
    ].join("\n");
    const promptPath = path.join(outputDir, "prompt.md");
    const rawAudioPath = path.join(outputDir, `${voiceSlug}-${versionId}.${sample.format}`);
    const playableAudioPath = sample.playableFormat
      ? path.join(outputDir, `${voiceSlug}-${versionId}.${sample.playableFormat}`)
      : rawAudioPath;
    const metadataPath = path.join(outputDir, "metadata.json");
    await atomicWrite(promptPath, fullPrompt);

    console.log(chalk.cyan(`Generating ${sample.modelLabel} / ${sample.voice}`));
    try {
      const audio = await client.generateSpeech({
        model: sample.model,
        input: speechInput,
        voice: sample.voice,
        format: sample.format
      });
      await atomicWrite(rawAudioPath, audio);
      if (sample.playableFormat === "wav") {
        await atomicWrite(playableAudioPath, pcm16MonoToWav(audio, 24000));
      }

      const metadata = {
        runId,
        target,
        provider: "openrouter",
        model: sample.model,
        modelLabel: sample.modelLabel,
        mode: "tts",
        duration: 12,
        format: sample.format,
        playableFormat: sample.playableFormat,
        voice: sample.voice,
        gender: sample.gender,
        language: "en",
        speechInput,
        bpm: config.bpm,
        promptHash: hashText(fullPrompt),
        promptPath: rel(config.rootDir, promptPath),
        rawAudioPath: rel(config.rootDir, rawAudioPath),
        audioPath: rel(config.rootDir, playableAudioPath),
        createdAt: new Date().toISOString()
      };
      await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
      await registry.addVersion(asset, {
        prompt: speechInput,
        fullPrompt,
        mode: "tts",
        model: sample.model,
        voice: sample.voice,
        language: "en",
        duration: 12,
        format: sample.playableFormat ?? sample.format,
        status: "completed",
        audioPath: metadata.audioPath,
        metadataPath: rel(config.rootDir, metadataPath)
      });
      completed += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await atomicWrite(metadataPath, `${JSON.stringify({ runId, target, status: "failed", model: sample.model, voice: sample.voice, gender: sample.gender, error: message, createdAt: new Date().toISOString() }, null, 2)}\n`);
      await registry.addVersion(asset, {
        prompt: speechInput,
        fullPrompt,
        mode: "tts",
        model: sample.model,
        voice: sample.voice,
        language: "en",
        duration: 12,
        format: sample.playableFormat ?? sample.format,
        status: "failed",
        metadataPath: rel(config.rootDir, metadataPath),
        error: message
      });
      console.error(chalk.red(`Failed ${sample.voice}: ${message}`));
    }
  }

  console.log(chalk.green(`Voice samples complete: ${completed} generated, ${skipped} skipped, ${failed} failed.`));
}

function pcm16MonoToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.byteLength, true);
  const wav = new Uint8Array(44 + pcm.byteLength);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm, 44);
  return wav;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
