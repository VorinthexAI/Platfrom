import path from "node:path";
import { readText } from "./filesystem";
import type { AssetRecord, EngineConfig, LockRecord } from "./types";
import { hashText } from "./utils";
import { systemIdentity } from "../prompts/system";
import { imageGenerationPrompt } from "../prompts/image-generation";
import { imageEditingPrompt } from "../prompts/image-editing";
import { lockPrompt } from "../prompts/lock";

const negativePrompt = `Do not include text.
Do not include watermark.
Do not include colored background.
Do not include red, pink, purple, blue or gold backgrounds.
Do not include glitter overload.
Do not include excessive sparkles.
Do not include unrelated symbols.
Do not create a badge that looks like a gaming logo.
Do not create a cartoon.
Do not create a flat icon unless requested.
Do not crop the logo.
Do not leave excessive empty margins.
Do not add shadows that require a background.
Do not add random letters.
Do not change locked geometry.`;

export type PromptBundle = {
  fullPrompt: string;
  designSystemHash: string;
  baselinePromptHash: string;
  lockRulesApplied: boolean;
};

export async function composePrompt(config: EngineConfig, input: {
  asset: AssetRecord;
  instruction: string;
  locks: Record<string, LockRecord>;
  mode: "generate" | "edit";
  exportKind: "solid" | "transparent";
}): Promise<PromptBundle> {
  const designSystem = await readText(path.join(config.rootDir, "design-system.md"));
  const baseline = await readText(path.join(config.rootDir, "baseline-prompt.md"));
  const rejected = await readText(path.join(config.rootDir, "memory/rejected-directions.md"));
  const lock = input.locks[input.asset.slug];
  const lockBlock = lock
    ? `${lockPrompt}
Lock level: ${lock.lockLevel}
Locked version: ${lock.lockedVersionId}
Rules:
${lock.rules.map((rule) => `- ${rule}`).join("\n")}`
    : "No asset lock is currently active.";
  const exportRequirements = input.exportKind === "transparent"
    ? "Export as a true transparent PNG with alpha. No background layer. No checkerboard."
    : `Export on solid obsidian background ${config.defaultSolidBackground}.`;
  const fullPrompt = [
    "# System Identity",
    systemIdentity,
    "",
    "# Design System",
    designSystem,
    "",
    "# Baseline Prompt",
    baseline,
    "",
    "# Mode",
    input.mode === "edit" ? imageEditingPrompt : imageGenerationPrompt,
    "",
    "# Locked Rules",
    lockBlock,
    "",
    "# Rejected Directions To Avoid",
    rejected,
    "",
    "# Asset",
    `Name: ${input.asset.name}`,
    `Slug: ${input.asset.slug}`,
    `Category: ${input.asset.category}`,
    input.asset.description ? `Description: ${input.asset.description}` : undefined,
    input.asset.designIntent ? `Design intent: ${input.asset.designIntent}` : undefined,
    "",
    "# Current Instruction",
    input.instruction,
    "",
    "# Export Requirements",
    exportRequirements,
    `Image size: ${config.defaultSize}`,
    "The visual mark must fill 85-95% of the canvas and remain centered.",
    "",
    "# Negative Prompt",
    negativePrompt
  ].filter((line) => line !== undefined).join("\n");

  return {
    fullPrompt,
    designSystemHash: hashText(designSystem),
    baselinePromptHash: hashText(baseline),
    lockRulesApplied: Boolean(lock)
  };
}

export { negativePrompt };
