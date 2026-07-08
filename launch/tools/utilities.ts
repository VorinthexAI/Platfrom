import { existsSync, readFileSync } from "node:fs";

export function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = unquoteEnvValue(rawValue);
  }
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function estimateImageTurnCostUsd(usage: unknown, prices: {
  textInputPerMillion: number;
  imageInputPerMillion: number;
  imageOutputPerMillion: number;
}): number {
  const typedUsage = usage as {
    input_tokens_details?: { image_tokens?: number; text_tokens?: number };
    output_tokens?: number;
  };
  const textInputTokens = typedUsage.input_tokens_details?.text_tokens ?? 0;
  const imageInputTokens = typedUsage.input_tokens_details?.image_tokens ?? 0;
  const outputTokens = typedUsage.output_tokens ?? 0;

  const textCost = (textInputTokens / 1_000_000) * prices.textInputPerMillion;
  const imageInCost = (imageInputTokens / 1_000_000) * prices.imageInputPerMillion;
  const imageOutCost = (outputTokens / 1_000_000) * prices.imageOutputPerMillion;

  return textCost + imageInCost + imageOutCost;
}

function unquoteEnvValue(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
    return value.slice(1, -1);
  }
  return value;
}
