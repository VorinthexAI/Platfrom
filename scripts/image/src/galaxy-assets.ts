import { mkdir } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { VORINTHEX_GALAXY_REGISTRY } from "../../../web/app/src/lib/galaxy/registry";
import type { GalaxyEntity } from "../../../web/app/src/lib/galaxy/registry-types";
import { generateVersion, type EngineContext } from "./cli";
import { loadConfig } from "./config";
import { atomicWrite, ensureRuntime } from "./filesystem";
import { OpenAIClient } from "./openai";
import { RegistryStore } from "./registry";
import type { AssetCategory } from "./types";

type GalaxyLogoTarget = {
  entity: GalaxyEntity;
  category: AssetCategory;
  assetSlug: string;
};

function targets(): GalaxyLogoTarget[] {
  return [
    ...Object.values(VORINTHEX_GALAXY_REGISTRY.products).map((entity) => ({
      entity,
      category: "product" as const,
      assetSlug: `product-${entity.slug}`
    })),
    ...Object.values(VORINTHEX_GALAXY_REGISTRY.capabilities).map((entity) => ({
      entity,
      category: "capability" as const,
      assetSlug: `capability-${entity.slug}`
    })),
    ...Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators).map((entity) => ({
      entity,
      category: "orchestrator" as const,
      assetSlug: `orchestrator-${entity.slug}`
    }))
  ];
}

function symbolDirection(entity: GalaxyEntity): string {
  if (entity.type === "product") {
    return `Create a premium sibling product logo for ${entity.name}. It should feel like it belongs beside the Vorinthex master logo: a centered chrome emblem, circular or orbital silhouette, obsidian negative space, sharp engineered geometry, and no text. Encode this product idea abstractly: ${entity.tagline ?? entity.shortDescription}.`;
  }
  if (entity.type === "capability") {
    return `Create a premium Core capability logo for ${entity.name}. It should share the Vorinthex master logo style: polished chrome, dark inner field, minimal geometric symbol, circular framing, and no text. Abstractly communicate: ${entity.shortDescription}`;
  }
  const role = entity.role ? `${entity.name} is the ${entity.role} / ${entity.fullTitle}.` : `${entity.name} is a Command orchestrator.`;
  return `Create a premium Command orchestrator logo for ${entity.name}. It should be a sibling to the Vorinthex master logo: circular chrome ring, dark center, precise executive insignia, no letters, no text. ${role} Abstractly communicate: ${entity.shortDescription}`;
}

function promptFor(entity: GalaxyEntity): string {
  const bullets = entity.content?.bullets?.length ? `Key ideas: ${entity.content.bullets.join("; ")}.` : "";
  return `${symbolDirection(entity)}

Keep the whole family visually consistent with the existing Vorinthex AI logo:
- obsidian black base
- polished chrome / silver material
- dark glass inner negative space
- one clear central geometric mark
- premium enterprise AI tone
- symmetrical, engineered, timeless
- fill 88-95% of the 1024x1024 box
- no text, no letters, no watermark, no colorful background

Entity metadata:
Name: ${entity.name}
Type: ${entity.type}
Tagline: ${entity.tagline ?? ""}
Description: ${entity.longDescription ?? entity.shortDescription}
${bullets}`;
}

async function createContext(): Promise<EngineContext> {
  const config = loadConfig();
  await ensureRuntime(config);
  const registry = new RegistryStore(config.rootDir);
  const client = new OpenAIClient(config);
  return { config, registry, client };
}

export async function generateGalaxyAssets(): Promise<void> {
  const context = await createContext();
  const generatedPromptsDir = path.join(context.config.rootDir, "prompts/generated");
  await mkdir(generatedPromptsDir, { recursive: true });

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const target of targets()) {
    const existing = await context.registry.getAsset(target.assetSlug);
    if (existing?.versions.length) {
      skipped += 1;
      console.log(chalk.gray(`Skipping ${target.assetSlug}; already has ${existing.versions.length} version(s).`));
      continue;
    }

    const prompt = promptFor(target.entity);
    await atomicWrite(path.join(generatedPromptsDir, `${target.assetSlug}.md`), `# ${target.entity.name} Logo Prompt

${prompt}
`);

    const asset = await context.registry.createAsset({
      name: target.entity.name,
      slug: target.assetSlug,
      category: target.category,
      description: target.entity.longDescription ?? target.entity.shortDescription,
      designIntent: `Logo for ${target.entity.type} entity ${target.entity.id}, generated from web/app/src/lib/galaxy/registry.ts.`
    });

    const version = await generateVersion(context, {
      asset,
      instruction: prompt,
      action: "Generate galaxy logo set",
      notes: `Generated from galaxy registry entity ${target.entity.id}`
    });
    if (version) created += 1;
    else failed += 1;
  }

  console.log(chalk.bold(`Galaxy logo generation complete: ${created} created, ${skipped} skipped, ${failed} failed.`));
}

if (import.meta.main) {
  generateGalaxyAssets().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
