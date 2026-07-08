import { mkdir } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { loadAudioConfig } from "../audio/src/config";
import { atomicWrite, ensureAudioRuntime, exists } from "../audio/src/filesystem";
import { OpenRouterAudioClient } from "../audio/src/openrouter";
import { AudioRegistryStore } from "../audio/src/registry";
import { hashText, rel, slugify } from "../audio/src/utils";

const MODEL = "hexgrad/kokoro-82m";
const MODEL_LABEL = "Kokoro 82M";
const FORMAT = "mp3";
const LANGUAGE = "en";

type OrchestratorMessage = {
  folder: string;
  slug: string;
  name: string;
  role: string;
  fullTitle: string;
  voice: string;
};

const orchestrators: OrchestratorMessage[] = [
  { folder: "apollo-cso", slug: "apollo", name: "Apollo", role: "CSO", fullTitle: "Chief Strategy Orchestrator", voice: "am_michael" },
  { folder: "athena-cpo", slug: "athena", name: "Athena", role: "CPO", fullTitle: "Chief Product Orchestrator", voice: "af_kore" },
  { folder: "atlas-ceo", slug: "atlas", name: "Atlas", role: "CEO", fullTitle: "Chief Executive Orchestrator", voice: "am_onyx" },
  { folder: "forge-cto", slug: "forge", name: "Forge", role: "CTO", fullTitle: "Chief Technology Orchestrator", voice: "am_fenrir" },
  { folder: "hermes-coo", slug: "hermes", name: "Hermes", role: "COO", fullTitle: "Chief Operations Orchestrator", voice: "bm_daniel" },
  { folder: "iris-cco", slug: "iris", name: "Iris", role: "CCO", fullTitle: "Chief Communications Orchestrator", voice: "af_aoede" },
  { folder: "ledger-cfo", slug: "ledger", name: "Ledger", role: "CFO", fullTitle: "Chief Financial Orchestrator", voice: "bm_george" },
  { folder: "mercury-cro", slug: "mercury", name: "Mercury", role: "CRO", fullTitle: "Chief Revenue Orchestrator", voice: "am_echo" },
  { folder: "metis-cio", slug: "metis", name: "Metis", role: "CIO", fullTitle: "Chief Intelligence Orchestrator", voice: "bf_emma" },
  { folder: "orbit-cmo", slug: "orbit", name: "Orbit", role: "CMO", fullTitle: "Chief Marketing Orchestrator", voice: "af_nova" },
  { folder: "sentinel-ciso", slug: "sentinel", name: "Sentinel", role: "CISO", fullTitle: "Chief Security Orchestrator", voice: "am_adam" },
  { folder: "themis-clo", slug: "themis", name: "Themis", role: "CLO", fullTitle: "Chief Legal Orchestrator", voice: "bf_isabella" },
];

async function main(): Promise<void> {
  const config = await loadAudioConfig(path.resolve(import.meta.dir, "../audio"));
  await ensureAudioRuntime(config.rootDir);

  const registry = new AudioRegistryStore(config.rootDir);
  const client = new OpenRouterAudioClient(config);
  const orchestratorRoot = import.meta.dir;
  let generated = 0;
  let registered = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of orchestrators) {
    const folderPath = path.join(orchestratorRoot, item.folder);
    const messagePath = path.join(folderPath, "MESSAGE.md");
    if (!await exists(messagePath)) throw new Error(`Missing MESSAGE.md for ${item.folder}`);

    const speechInput = (await Bun.file(messagePath).text()).trim();
    const fullPrompt = [
      `Create the spoken orchestrator introduction for ${item.name}.`,
      "",
      `Model: ${MODEL}`,
      `Voice: ${item.voice}`,
      `Role: ${item.role}`,
      `Title: ${item.fullTitle}`,
      "",
      speechInput,
    ].join("\n");
    const promptHash = hashText(fullPrompt);
    const assetSlug = `orchestrator-${item.slug}-message`;
    const asset = await registry.createAsset({
      slug: assetSlug,
      name: `${item.name} Message`,
      category: "orchestrator",
      entityId: `orchestrator.${item.slug}`,
      description: `${item.name} spoken persona message generated with ${MODEL_LABEL} voice ${item.voice}.`,
    });

    const existing = asset.versions.find((version) =>
      version.status === "completed" &&
      version.model === MODEL &&
      version.voice === item.voice &&
      version.prompt === speechInput &&
      version.audioPath &&
      version.metadataPath
    );
    if (existing) {
      skipped += 1;
      const existingAudioPath = path.join(config.rootDir, existing.audioPath);
      const localAudioPath = path.join(folderPath, "message.mp3");
      if (await exists(existingAudioPath) && !await exists(localAudioPath)) {
        await atomicWrite(localAudioPath, new Uint8Array(await Bun.file(existingAudioPath).arrayBuffer()));
      }
      continue;
    }

    const versionId = `v${Math.max(0, ...asset.versions.map((version) => version.version)) + 1}`;
    const outputDir = path.join(config.rootDir, "outputs/audio/orchestrator-messages", item.slug, versionId);
    const audioPath = path.join(outputDir, `${item.slug}-message-${versionId}.mp3`);
    const promptPath = path.join(outputDir, "prompt.md");
    const metadataPath = path.join(outputDir, "metadata.json");
    const localAudioPath = path.join(folderPath, "message.mp3");
    const localMetadataPath = path.join(folderPath, "message.metadata.json");

    await mkdir(outputDir, { recursive: true });
    await atomicWrite(promptPath, fullPrompt);

    try {
      console.log(`Generating ${item.name} with ${item.voice}`);
      const audio = await client.generateSpeech({
        model: MODEL,
        input: speechInput,
        voice: item.voice,
        format: FORMAT,
      });

      await atomicWrite(audioPath, audio);
      await atomicWrite(localAudioPath, audio);

      const metadata = {
        runId: nanoid(12),
        target: {
          slug: item.slug,
          name: item.name,
          category: "orchestrator",
          entityId: `orchestrator.${item.slug}`,
          description: `${item.name}, ${item.fullTitle}.`,
        },
        provider: "openrouter",
        model: MODEL,
        modelLabel: MODEL_LABEL,
        mode: "tts",
        format: FORMAT,
        voice: item.voice,
        language: LANGUAGE,
        speechInput,
        promptHash,
        promptPath: rel(config.rootDir, promptPath),
        audioPath: rel(config.rootDir, audioPath),
        localAudioPath: rel(path.resolve(orchestratorRoot, ".."), localAudioPath),
        createdAt: new Date().toISOString(),
      };
      const metadataJson = `${JSON.stringify(metadata, null, 2)}\n`;
      await atomicWrite(metadataPath, metadataJson);
      await atomicWrite(localMetadataPath, metadataJson);

      await registry.addVersion(asset, {
        prompt: speechInput,
        fullPrompt,
        mode: "tts",
        model: MODEL,
        voice: item.voice,
        language: LANGUAGE,
        duration: 30,
        format: FORMAT,
        status: "completed",
        audioPath: metadata.audioPath,
        metadataPath: rel(config.rootDir, metadataPath),
      });
      generated += 1;
      registered += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      const metadata = {
        runId: nanoid(12),
        target: {
          slug: item.slug,
          name: item.name,
          category: "orchestrator",
          entityId: `orchestrator.${item.slug}`,
        },
        provider: "openrouter",
        model: MODEL,
        modelLabel: MODEL_LABEL,
        mode: "tts",
        format: FORMAT,
        voice: item.voice,
        language: LANGUAGE,
        speechInput,
        promptHash,
        status: "failed",
        error: message,
        createdAt: new Date().toISOString(),
      };
      await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
      await atomicWrite(localMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
      await registry.addVersion(asset, {
        prompt: speechInput,
        fullPrompt,
        mode: "tts",
        model: MODEL,
        voice: item.voice,
        language: LANGUAGE,
        duration: 30,
        format: FORMAT,
        status: "failed",
        metadataPath: rel(config.rootDir, metadataPath),
        error: message,
      });
      console.error(`Failed ${item.name}: ${message}`);
    }
  }

  console.log(`Message audio complete: ${generated} generated, ${registered} registered, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
