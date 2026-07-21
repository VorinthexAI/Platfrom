import { mkdir } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { nanoid } from "nanoid";
import ora from "ora";
import prompts from "prompts";
import { backupRegistry } from "./backup";
import { loadConfig } from "./config";
import { exportAssetPackage, createFullAssetPackage } from "./export";
import { atomicWrite, ensureRuntime, readText, appendMarkdown } from "./filesystem";
import { copyLatest, createReviewSheet, createSolidFromTransparent, createTransparentFromSolid, normalizeLogo, validatePng } from "./image";
import { defaultLockRules, isFrozen } from "./locks";
import { OpenAIClient } from "./openai";
import { composePrompt } from "./prompts";
import { RegistryStore } from "./registry";
import { createLogoSvgs } from "./svg";
import { validateLockedAssets } from "./validate";
import type { AssetCategory, AssetRecord, AssetVersion, EngineConfig, Metadata } from "./types";
import { assetCategorySchema, lockLevelSchema } from "./types";
import { hashText, nowIso, rel, slugify } from "./utils";

export type EngineContext = {
  config: EngineConfig;
  registry: RegistryStore;
  client?: OpenAIClient;
};

const menuChoices = [
  "New asset",
  "Continue asset",
  "Improve asset",
  "Generate variants",
  "Review asset",
  "Compare versions",
  "Lock asset",
  "Unlock asset",
  "Export asset",
  "List assets",
  "Show asset history",
  "Update design system",
  "Update baseline prompt",
  "Regenerate transparent version",
  "Regenerate solid-background version",
  "Upscale / enhance",
  "Generate TikTok slideshow",
  "Create full asset package",
  "Validate locked assets",
  "Backup registry",
  "Exit"
] as const;

function latestVersion(asset: AssetRecord): AssetVersion | undefined {
  return asset.versions.find((version) => version.id === asset.currentVersionId) ?? asset.versions.at(-1);
}

async function selectAsset(registry: RegistryStore): Promise<AssetRecord | undefined> {
  const assets = await registry.listAssets();
  if (assets.length === 0) {
    console.log(chalk.yellow("No assets found."));
    return undefined;
  }
  const answer = await prompts({
    type: "select",
    name: "slug",
    message: "Select asset:",
    choices: assets.map((asset) => ({ title: `${asset.name} (${asset.slug}) ${asset.locked ? "[locked]" : ""}`, value: asset.slug }))
  });
  return answer.slug ? registry.getAsset(answer.slug) : undefined;
}

async function selectVersion(asset: AssetRecord): Promise<AssetVersion | undefined> {
  if (asset.versions.length === 0) {
    console.log(chalk.yellow("Asset has no versions."));
    return undefined;
  }
  const answer = await prompts({
    type: "select",
    name: "id",
    message: "Select version:",
    choices: asset.versions.map((version) => ({ title: `${version.id} (${version.createdAt})`, value: version.id })).reverse()
  });
  return asset.versions.find((version) => version.id === answer.id);
}

async function requireClient(context: EngineContext): Promise<OpenAIClient | undefined> {
  if (context.client) return context.client;
  console.log(chalk.red("No OpenAI API key found. Add OPENAI_API_KEY to scripts/image/.env before generating or reviewing images."));
  return undefined;
}

export async function generateVersion(context: EngineContext, input: {
  asset: AssetRecord;
  instruction: string;
  action: string;
  sourceVersion?: AssetVersion;
  exportKind?: "both" | "solid" | "transparent";
  notes?: string;
}): Promise<AssetVersion | undefined> {
  const client = await requireClient(context);
  if (!client) return undefined;
  const locks = await context.registry.getLocks();
  if (isFrozen(input.asset, locks) && input.action !== "Regenerate solid" && input.action !== "Regenerate transparent") {
    console.log(chalk.red("This asset is frozen. Only background/export processing is allowed until it is unlocked."));
    return undefined;
  }
  const nextNumber = Math.max(0, ...input.asset.versions.map((version) => version.version)) + 1;
  const versionId = `v${nextNumber}`;
  const runId = nanoid(12);
  const assetDir = path.join(context.config.rootDir, "assets", input.asset.category, input.asset.slug, versionId);
  const runDir = path.join(context.config.rootDir, "runs", runId);
  await mkdir(assetDir, { recursive: true });
  await mkdir(runDir, { recursive: true });

  const spinner = ora(`Generating ${input.asset.slug} ${versionId}`).start();
  try {
    await context.registry.appendRun({ runId, assetId: input.asset.id, versionId, action: input.action, createdAt: nowIso(), status: "started" });
    const solidPath = path.join(assetDir, "solid-1024.png");
    const transparentPath = path.join(assetDir, "transparent-1024.png");
    const solidPrompt = await composePrompt(context.config, { asset: input.asset, instruction: input.instruction, locks, mode: input.sourceVersion ? "edit" : "generate", exportKind: "solid" });
    const transparentPrompt = await composePrompt(context.config, { asset: input.asset, instruction: input.instruction, locks, mode: input.sourceVersion ? "edit" : "generate", exportKind: "transparent" });
    const fullPromptPath = path.join(assetDir, "prompt.md");
    await atomicWrite(fullPromptPath, `# Solid Prompt\n\n${solidPrompt.fullPrompt}\n\n# Transparent Prompt\n\n${transparentPrompt.fullPrompt}\n`);

    const sourcePath = input.sourceVersion?.transparentPath || input.sourceVersion?.solidPath;
    const absoluteSource = sourcePath ? path.join(context.config.rootDir, sourcePath) : undefined;
    let solidRel: string | undefined;
    let transparentRel: string | undefined;

    if (input.exportKind !== "transparent") {
      await (absoluteSource ? client.editImage : client.generateImage).call(client, {
        prompt: solidPrompt.fullPrompt,
        outputPath: solidPath,
        background: "opaque",
        sourceImagePath: absoluteSource
      });
      await normalizeLogo(solidPath, solidPath, context.config);
      const solidValidation = await validatePng(solidPath, context.config, false);
      if (!solidValidation.ok) throw new Error(`Solid validation failed: ${solidValidation.problems.join(", ")}`);
      solidRel = rel(context.config.rootDir, solidPath);
      await copyLatest(solidPath, path.join(context.config.rootDir, "outputs/latest", `${input.asset.slug}-solid-1024.png`));
      await copyLatest(solidPath, path.join(context.config.rootDir, "outputs/solid", `${input.asset.slug}-${versionId}-solid-1024.png`));
    }

    if (input.exportKind !== "solid") {
      try {
        await (absoluteSource ? client.editImage : client.generateImage).call(client, {
          prompt: transparentPrompt.fullPrompt,
          outputPath: transparentPath,
          background: "transparent",
          sourceImagePath: absoluteSource
        });
        await normalizeLogo(transparentPath, transparentPath, context.config);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes("transparent background is not supported")) throw error;
        if (!solidRel) {
          await client.generateImage({
            prompt: solidPrompt.fullPrompt,
            outputPath: solidPath,
            background: "opaque"
          });
          await normalizeLogo(solidPath, solidPath, context.config);
          solidRel = rel(context.config.rootDir, solidPath);
        }
        console.log(chalk.yellow("Model rejected transparent background. Falling back to local background removal from the solid PNG."));
        await createTransparentFromSolid(path.join(context.config.rootDir, solidRel), transparentPath, context.config);
      }
      let transparentValidation = await validatePng(transparentPath, context.config, true);
      if (!transparentValidation.ok && solidRel) {
        await createTransparentFromSolid(path.join(context.config.rootDir, solidRel), transparentPath, context.config);
        transparentValidation = await validatePng(transparentPath, context.config, true);
      }
      if (!transparentValidation.ok) throw new Error(`Transparent validation failed: ${transparentValidation.problems.join(", ")}`);
      transparentRel = rel(context.config.rootDir, transparentPath);
      await copyLatest(transparentPath, path.join(context.config.rootDir, "outputs/latest", `${input.asset.slug}-transparent-1024.png`));
      await copyLatest(transparentPath, path.join(context.config.rootDir, "outputs/transparent", `${input.asset.slug}-${versionId}-transparent-1024.png`));
    }

    if (!solidRel && transparentRel) {
      await createSolidFromTransparent(path.join(context.config.rootDir, transparentRel), solidPath, context.config);
      solidRel = rel(context.config.rootDir, solidPath);
    }
    if (!transparentRel && solidRel) {
      await createTransparentFromSolid(path.join(context.config.rootDir, solidRel), transparentPath, context.config);
      transparentRel = rel(context.config.rootDir, transparentPath);
    }
    const svgPaths = await createLogoSvgs({
      config: context.config,
      assetName: input.asset.name,
      solidPath: solidRel,
      transparentPath: transparentRel
    });

    const reviewPath = path.join(runDir, "review.md");
    const reviewText = await import("./review").then((module) => module.writeReview({
      client,
      imagePath: transparentRel ? path.join(context.config.rootDir, transparentRel) : path.join(context.config.rootDir, solidRel!),
      prompt: transparentPrompt.fullPrompt,
      reviewPath
    }));
    const metadataPath = path.join(assetDir, "metadata.json");
    const metadata: Metadata = {
      runId,
      assetId: input.asset.id,
      versionId,
      model: context.config.imageModel,
      size: context.config.defaultSize,
      createdAt: nowIso(),
      promptHash: hashText(`${solidPrompt.fullPrompt}\n${transparentPrompt.fullPrompt}`),
      fullPromptPath: rel(context.config.rootDir, fullPromptPath),
      solidPath: solidRel,
      transparentPath: transparentRel,
      reviewPath: rel(context.config.rootDir, reviewPath),
      designSystemHash: solidPrompt.designSystemHash,
      baselinePromptHash: solidPrompt.baselinePromptHash,
      lockRulesApplied: solidPrompt.lockRulesApplied || transparentPrompt.lockRulesApplied
    };
    await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

    const version = await context.registry.addVersion(input.asset, {
      prompt: input.instruction,
      fullPrompt: await readText(fullPromptPath),
      solidPath: solidRel,
      transparentPath: transparentRel,
      solidSvgPath: svgPaths.solidSvgPath,
      transparentSvgPath: svgPaths.transparentSvgPath,
      sourceImagePath: input.sourceVersion?.transparentPath || input.sourceVersion?.solidPath,
      metadataPath: rel(context.config.rootDir, metadataPath),
      reviewPath: rel(context.config.rootDir, reviewPath),
      accepted: false,
      rejected: false,
      notes: input.notes || reviewText.split("\n").slice(0, 5).join(" ")
    });
    await context.registry.appendRun({ runId, assetId: input.asset.id, versionId, action: input.action, createdAt: nowIso(), status: "completed" });
    spinner.succeed(`Generated ${input.asset.slug} ${version.id}`);
    console.log(chalk.green("Generated:"));
    if (solidRel) console.log(`- ${solidRel}`);
    if (transparentRel) console.log(`- ${transparentRel}`);
    console.log(`- ${rel(context.config.rootDir, metadataPath)}`);
    console.log(`- ${metadata.reviewPath}`);
    return version;
  } catch (error) {
    spinner.fail("Generation failed");
    console.error(error instanceof Error ? error.message : error);
    return undefined;
  }
}

async function newAsset(context: EngineContext): Promise<void> {
  if (!await requireClient(context)) return;
  const answer = await prompts([
    { type: "text", name: "name", message: "Asset name:", initial: "Vorinthex AI", validate: (value: string) => value.trim().length > 0 || "Asset name is required." },
    { type: "text", name: "slug", message: "Asset slug:", initial: (_: unknown, values: { name?: string }) => slugify(values.name || "vorinthex-ai"), validate: (value: string) => value.trim().length > 0 || "Asset slug is required." },
    { type: "select", name: "category", message: "Category:", choices: assetCategorySchema.options.map((value) => ({ title: value, value })), initial: 0 },
    { type: "text", name: "description", message: "Description:", initial: "A minimal chrome circular ring enclosing a sharp downward triangular nexus emblem. The icon should be clean, dark, premium and metallic. The inner field should be dark/transparent depending on export. No text. No extra glitter. The symbol should fill most of the 1024x1024 canvas." },
    { type: "text", name: "designIntent", message: "Design intent:" },
    { type: "text", name: "prompt", message: "Prompt:", validate: (value: string) => value.trim().length > 0 || "Prompt is required to generate an image." },
    { type: "number", name: "variants", message: "Generate how many variants?", initial: 1, min: 1, max: 8 }
  ]);
  if (!answer.name || !answer.prompt) {
    console.log(chalk.yellow("New asset cancelled. No files were generated."));
    return;
  }
  const asset = await context.registry.createAsset({
    name: answer.name,
    slug: answer.slug,
    category: answer.category as AssetCategory,
    description: answer.description,
    designIntent: answer.designIntent
  });
  const createdVersions: AssetVersion[] = [];
  for (let index = 0; index < answer.variants; index += 1) {
    const version = await generateVersion(context, { asset, instruction: answer.prompt, action: "New asset", notes: `Variant ${index + 1}` });
    if (version) createdVersions.push(version);
  }
  if (createdVersions.length === 0) {
    console.log(chalk.yellow("No versions were generated, so there is nothing to lock, improve, or export yet."));
    return;
  }
  await postGenerationNext(context, asset);
}

async function postGenerationNext(context: EngineContext, asset: AssetRecord): Promise<void> {
  const refreshed = await context.registry.getAsset(asset.slug);
  if (!refreshed) return;
  const answer = await prompts({
    type: "select",
    name: "next",
    message: "What next?",
    choices: ["Lock this version", "Improve", "Generate variants", "Reject", "Export package", "Back to menu"].map((value) => ({ title: value, value }))
  });
  if (answer.next === "Lock this version") await lockAsset(context, refreshed);
  if (answer.next === "Improve") await improveAsset(context, refreshed);
  if (answer.next === "Generate variants") await generateVariants(context, refreshed);
  if (answer.next === "Reject") await rejectLatest(context, refreshed);
  if (answer.next === "Export package") await exportAsset(context, refreshed);
}

async function continueAsset(context: EngineContext): Promise<void> {
  const asset = await selectAsset(context.registry);
  if (!asset) return;
  const current = latestVersion(asset);
  console.log(chalk.cyan(`Current: ${current?.id ?? "none"} | locked: ${asset.locked ? "yes" : "no"}`));
  if (current?.notes) console.log(`Latest notes: ${current.notes}`);
  if (current?.prompt) console.log(`Latest prompt: ${current.prompt}`);
  const answer = await prompts([
    { type: "text", name: "change", message: "What should change?" },
    {
      type: asset.locked ? "select" : null,
      name: "scope",
      message: "Change scope:",
      choices: [{ title: "minor", value: "minor" }, { title: "major", value: "major" }]
    }
  ]);
  if (!answer.change) return;
  if (asset.locked && answer.scope === "major") {
    console.log(chalk.red("This asset is locked. Unlock first."));
    return;
  }
  await generateVersion(context, { asset, instruction: answer.change, action: "Continue asset", sourceVersion: current });
}

async function improveAsset(context: EngineContext, preselected?: AssetRecord): Promise<void> {
  const asset = preselected ?? await selectAsset(context.registry);
  if (!asset) return;
  const version = await selectVersion(asset);
  if (!version) return;
  const answer = await prompts({ type: "text", name: "instruction", message: "What should improve?" });
  if (!answer.instruction) return;
  await generateVersion(context, { asset, instruction: answer.instruction, action: "Improve asset", sourceVersion: version });
}

async function generateVariants(context: EngineContext, preselected?: AssetRecord): Promise<void> {
  const asset = preselected ?? await selectAsset(context.registry);
  if (!asset) return;
  const current = latestVersion(asset);
  const answer = await prompts([
    { type: "number", name: "count", message: "How many variants?", initial: 3, min: 1, max: 8 },
    { type: "select", name: "difference", message: "How different should they be?", choices: ["subtle", "medium", "bold"].map((value) => ({ title: value, value })) }
  ]);
  if (!answer.count) return;
  if (asset.locked && answer.difference === "bold") {
    console.log(chalk.red("Locked assets only allow subtle or medium variants unless unlocked."));
    return;
  }
  for (let index = 0; index < answer.count; index += 1) {
    await generateVersion(context, {
      asset,
      instruction: `Create a ${answer.difference} variant. Preserve accepted identity and improve premium execution.`,
      action: "Generate variants",
      sourceVersion: current,
      notes: `${answer.difference} variant ${index + 1}`
    });
  }
}

async function reviewAsset(context: EngineContext): Promise<void> {
  const client = await requireClient(context);
  if (!client) return;
  const asset = await selectAsset(context.registry);
  if (!asset) return;
  const version = await selectVersion(asset);
  if (!version) return;
  const imagePath = version.transparentPath || version.solidPath;
  if (!imagePath) return;
  const reviewPath = path.join(context.config.rootDir, "runs", nanoid(12), "review.md");
  const review = await import("./review").then((module) => module.writeReview({ client, imagePath: path.join(context.config.rootDir, imagePath), prompt: version.fullPrompt, reviewPath }));
  version.reviewPath = rel(context.config.rootDir, reviewPath);
  version.notes = review.split("\n").slice(0, 5).join(" ");
  await context.registry.upsertAsset(asset);
  console.log(review);
}

async function compareVersions(context: EngineContext): Promise<void> {
  const asset = await selectAsset(context.registry);
  if (!asset) return;
  const a = await selectVersion(asset);
  const b = await selectVersion(asset);
  if (!a || !b) return;
  const aPath = a.transparentPath || a.solidPath;
  const bPath = b.transparentPath || b.solidPath;
  if (!aPath || !bPath) return;
  const sheetPath = path.join(context.config.rootDir, "outputs/review-sheets", `${asset.slug}-${a.id}-${b.id}.png`);
  await createReviewSheet(path.join(context.config.rootDir, aPath), path.join(context.config.rootDir, bPath), sheetPath);
  const prompt = `Compare two versions of ${asset.name}.
Version A: ${a.id}
Version B: ${b.id}
Return:
Version A:
Version B:
Differences:
Which is closer to lock:
Which is better for app icon:
Which is better for web:
Recommendation:`;
  if (context.client) console.log(await context.client.compareImages({ aPath: path.join(context.config.rootDir, aPath), bPath: path.join(context.config.rootDir, bPath), prompt }));
  console.log(`Review sheet: ${rel(context.config.rootDir, sheetPath)}`);
}

async function lockAsset(context: EngineContext, preselected?: AssetRecord): Promise<void> {
  const asset = preselected ?? await selectAsset(context.registry);
  if (!asset) return;
  const version = await selectVersion(asset);
  if (!version) return;
  console.log(chalk.cyan(`Version: ${version.id}`));
  if (version.solidPath) console.log(`solid: ${version.solidPath}`);
  if (version.transparentPath) console.log(`transparent: ${version.transparentPath}`);
  if (version.reviewPath) console.log(`review: ${version.reviewPath}`);
  const review = version.reviewPath ? await readText(path.join(context.config.rootDir, version.reviewPath)) : "";
  const answer = await prompts([
    { type: "select", name: "level", message: "Lock level:", choices: lockLevelSchema.options.map((value) => ({ title: value, value })), initial: 2 },
    { type: "list", name: "rules", message: "Lock rules:", initial: defaultLockRules(asset, review).join(", ") },
    { type: "confirm", name: "confirm", message: "Lock this version?", initial: false }
  ]);
  if (!answer.confirm) return;
  await context.registry.lockAsset(asset, version.id, answer.level, answer.rules);
  console.log(chalk.green(`Locked ${asset.slug} ${version.id}.`));
}

async function unlockAsset(context: EngineContext): Promise<void> {
  const asset = await selectAsset(context.registry);
  if (!asset) return;
  const answer = await prompts([
    { type: "text", name: "confirmation", message: `Type UNLOCK ${asset.slug} to continue.` },
    { type: "text", name: "reason", message: "Reason:" }
  ]);
  if (answer.confirmation !== `UNLOCK ${asset.slug}`) {
    console.log(chalk.yellow("Unlock cancelled."));
    return;
  }
  await context.registry.unlockAsset(asset, answer.reason || "No reason provided.");
  console.log(chalk.green(`Unlocked ${asset.slug}.`));
}

async function exportAsset(context: EngineContext, preselected?: AssetRecord): Promise<void> {
  const asset = preselected ?? await selectAsset(context.registry);
  if (!asset) return;
  const version = await selectVersion(asset);
  if (!version) return;
  const dir = await exportAssetPackage(context.config, context.registry, asset, version);
  console.log(chalk.green(`Export package: ${rel(context.config.rootDir, dir)}`));
}

async function listAssets(context: EngineContext): Promise<void> {
  const assets = await context.registry.listAssets();
  if (assets.length === 0) {
    console.log("No assets.");
    return;
  }
  for (const asset of assets) {
    console.log(`${asset.slug} | ${asset.name} | ${asset.category} | ${asset.status} | versions: ${asset.versions.length} | locked: ${asset.locked}`);
  }
}

async function showHistory(context: EngineContext): Promise<void> {
  console.log(await readText(path.join(context.config.rootDir, "memory/history.md")));
}

async function editTextFile(context: EngineContext, relativePath: string, label: string): Promise<void> {
  const current = await readText(path.join(context.config.rootDir, relativePath));
  const answer = await prompts({ type: "text", name: "content", message: `${label} content:`, initial: current });
  if (!answer.content) return;
  await atomicWrite(path.join(context.config.rootDir, relativePath), answer.content.endsWith("\n") ? answer.content : `${answer.content}\n`);
  await context.registry.appendHistory({ name: label, slug: relativePath }, `Updated ${label}`);
}

async function regenerateTransparent(context: EngineContext): Promise<void> {
  const asset = await selectAsset(context.registry);
  if (!asset) return;
  const version = await selectVersion(asset);
  if (!version?.solidPath) return;
  await generateVersion(context, { asset, instruction: "Regenerate only the transparent version with true alpha while preserving geometry.", action: "Regenerate transparent", sourceVersion: version, exportKind: "transparent" });
}

async function regenerateSolid(context: EngineContext): Promise<void> {
  const asset = await selectAsset(context.registry);
  if (!asset) return;
  const version = await selectVersion(asset);
  if (!version?.transparentPath) return;
  const solidPath = path.join(context.config.rootDir, "assets", asset.category, asset.slug, `${version.id}-solid-regenerated-1024.png`);
  await createSolidFromTransparent(path.join(context.config.rootDir, version.transparentPath), solidPath, context.config);
  version.solidPath = rel(context.config.rootDir, solidPath);
  await context.registry.upsertAsset(asset);
  console.log(chalk.green(`Solid regenerated: ${version.solidPath}`));
}

async function upscaleEnhance(context: EngineContext): Promise<void> {
  const asset = await selectAsset(context.registry);
  if (!asset) return;
  const version = await selectVersion(asset);
  if (!version) return;
  await generateVersion(context, { asset, instruction: "Upscale and enhance material realism, edge crispness, centered composition, and logo fill. Preserve identity.", action: "Upscale / enhance", sourceVersion: version });
}

async function fullPackage(context: EngineContext): Promise<void> {
  const asset = await selectAsset(context.registry);
  if (!asset) return;
  const version = await selectVersion(asset);
  if (!version) return;
  const dir = await createFullAssetPackage(context.config, context.registry, asset, version);
  console.log(chalk.green(`Full asset package: ${rel(context.config.rootDir, dir)}`));
}

async function generateTikTokSlideshow(context: EngineContext): Promise<void> {
  if (!await requireClient(context)) return;
  await import("./slideshow").then((module) => module.generateSlideshow());
}

async function rejectLatest(context: EngineContext, asset: AssetRecord): Promise<void> {
  const version = latestVersion(asset);
  if (!version) return;
  const answer = await prompts({ type: "text", name: "reason", message: "Rejected because:" });
  version.rejected = true;
  asset.status = "rejected";
  await appendMarkdown(path.join(context.config.rootDir, "memory/rejected-directions.md"), `\n## ${asset.name} ${version.id}\n\nRejected: ${answer.reason || "No reason provided."}\n`);
  await context.registry.upsertAsset(asset);
  await context.registry.appendHistory(asset, `Rejected ${version.id}`, answer.reason);
}

export async function runCli(): Promise<void> {
  const config = loadConfig();
  await ensureRuntime(config);
  const registry = new RegistryStore(config.rootDir);
  let client: OpenAIClient | undefined;
  try {
    client = new OpenAIClient(config);
  } catch {
    client = undefined;
  }
  const context: EngineContext = { config, registry, client };
  console.log(chalk.bold("Vorinthex AI Local Design Engine"));
  if (!client) {
    console.log(chalk.yellow("OPENAI_API_KEY is not configured. You can list, validate, backup, edit prompts, and manage existing files, but generation/review will be blocked."));
  }
  let running = true;
  while (running) {
    const answer = await prompts({
      type: "select",
      name: "mode",
      message: "Choose mode:",
      choices: menuChoices.map((title, index) => ({ title: `${index + 1}. ${title}`, value: title }))
    });
    switch (answer.mode as typeof menuChoices[number] | undefined) {
      case "New asset": await newAsset(context); break;
      case "Continue asset": await continueAsset(context); break;
      case "Improve asset": await improveAsset(context); break;
      case "Generate variants": await generateVariants(context); break;
      case "Review asset": await reviewAsset(context); break;
      case "Compare versions": await compareVersions(context); break;
      case "Lock asset": await lockAsset(context); break;
      case "Unlock asset": await unlockAsset(context); break;
      case "Export asset": await exportAsset(context); break;
      case "List assets": await listAssets(context); break;
      case "Show asset history": await showHistory(context); break;
      case "Update design system": await editTextFile(context, "design-system.md", "design system"); break;
      case "Update baseline prompt": await editTextFile(context, "baseline-prompt.md", "baseline prompt"); break;
      case "Regenerate transparent version": await regenerateTransparent(context); break;
      case "Regenerate solid-background version": await regenerateSolid(context); break;
      case "Upscale / enhance": await upscaleEnhance(context); break;
      case "Generate TikTok slideshow": await generateTikTokSlideshow(context); break;
      case "Create full asset package": await fullPackage(context); break;
      case "Validate locked assets": {
        const result = await validateLockedAssets(config.rootDir);
        console.log(result.ok ? chalk.green("Locked asset validation passed.") : chalk.red(result.problems.join("\n")));
        break;
      }
      case "Backup registry": console.log(`Backup written: ${await backupRegistry(config.rootDir)}`); break;
      case "Exit":
      case undefined:
        running = false;
        break;
    }
  }
}
