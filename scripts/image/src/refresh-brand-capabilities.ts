import { CORE_CAPABILITIES } from "../../../web/app/src/lib/core";
import { generateVersion, type EngineContext } from "./cli";
import { loadConfig } from "./config";
import { ensureRuntime } from "./filesystem";
import { OpenAIClient } from "./openai";
import { RegistryStore } from "./registry";

async function createContext(): Promise<EngineContext> {
  const config = loadConfig();
  await ensureRuntime(config);
  return {
    config,
    registry: new RegistryStore(config.rootDir),
    client: new OpenAIClient(config)
  };
}

function masterPrompt(): string {
  return `Create a new definitive Vorinthex AI master logo in the same premium obsidian chrome style.

Concept:
- a shallow 3D globe viewed from the front
- the globe silhouette should subtly read as a capital V from the front
- include one clean orbit line inside the globe, like intelligence moving through the sphere
- the mark should feel like a futuristic AI world, not a literal planet illustration
- premium polished chrome edges, dark obsidian glass interior, precise engineered geometry
- minimal, iconic, symmetrical, app-icon readable
- fill 88-95% of the 1024x1024 canvas with a small safe margin
- no text, no letters, no watermark, no clutter, no colorful background, no glitter`;
}

function simpleCapabilityPrompt(name: string, description: string): string {
  return `Create a simpler cleaner logo for the Core capability named ${name}.

Keep it in the same Vorinthex family as the master logo:
- obsidian black and polished chrome
- minimal circular or orbital frame
- one simple central symbol only
- flatter, cleaner, less detailed than the previous capability logos
- premium AI software icon, not decorative art
- strong silhouette at small sizes
- fill 88-95% of the 1024x1024 canvas
- no text, no letters, no watermark, no colorful background

Capability meaning:
${name}: ${description}

Use only the simplest abstract geometry needed to suggest this capability.`;
}

export async function refreshBrandAndCapabilities(): Promise<void> {
  const context = await createContext();

  const master = await context.registry.createAsset({
    name: "Vorinthex AI Globe V",
    slug: "vorinthex-ai-globe-v",
    category: "master-brand",
    description: "A shallow globe-like Vorinthex master mark that reads as a V from the front, with a clean internal orbit.",
    designIntent: "New master logo direction requested for Vorinthex AI."
  });

  await generateVersion(context, {
    asset: master,
    instruction: masterPrompt(),
    action: "Refresh Vorinthex master logo",
    notes: "Globe V master logo direction with internal orbit."
  });

  for (const capability of CORE_CAPABILITIES) {
    const capabilitySlug = capability.name.toLowerCase();
    const slug = `capability-${capabilitySlug}`;
    const asset = await context.registry.createAsset({
      name: capability.name,
      slug,
      category: "capability",
      description: capability.description,
      designIntent: `Simplified Core capability logo refresh for capability.${capabilitySlug}.`
    });

    await generateVersion(context, {
      asset,
      instruction: simpleCapabilityPrompt(capability.name, capability.description),
      action: "Refresh simple capability logo",
      notes: "Simpler capability logo refresh."
    });
  }
}

if (import.meta.main) {
  refreshBrandAndCapabilities().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
