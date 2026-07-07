import { copyFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { EngineConfig } from "./types";
import { parseSize } from "./utils";

export type ImageValidation = {
  ok: boolean;
  problems: string[];
  width?: number;
  height?: number;
  hasAlpha?: boolean;
};

export async function validatePng(filePath: string, config: EngineConfig, requireAlpha: boolean): Promise<ImageValidation> {
  const problems: string[] = [];
  try {
    const file = await stat(filePath);
    if (file.size <= 0) problems.push("file size is 0");
  } catch {
    return { ok: false, problems: ["file does not exist"] };
  }

  const metadata = await sharp(filePath).metadata();
  const stats = await sharp(filePath).ensureAlpha().stats();
  const expected = parseSize(config.defaultSize);
  if (metadata.format !== "png") problems.push(`expected PNG, got ${metadata.format ?? "unknown"}`);
  if (metadata.width !== expected.width || metadata.height !== expected.height) {
    problems.push(`expected ${config.defaultSize}, got ${metadata.width}x${metadata.height}`);
  }
  if (requireAlpha && !metadata.hasAlpha) problems.push("transparent output has no alpha channel");
  if (requireAlpha && stats.channels[3]?.min === 255) problems.push("transparent output has alpha channel but no transparent pixels");
  return {
    ok: problems.length === 0,
    problems,
    width: metadata.width,
    height: metadata.height,
    hasAlpha: metadata.hasAlpha
  };
}

export async function normalizeLogo(inputPath: string, outputPath: string, config: EngineConfig): Promise<void> {
  const { width, height } = parseSize(config.defaultSize);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const finalOutputPath = path.resolve(outputPath);
  const sharpOutputPath = path.resolve(inputPath) === finalOutputPath
    ? `${finalOutputPath}.${process.pid}.${Date.now()}.normalized.png`
    : finalOutputPath;
  const image = sharp(inputPath).png().resize({
    width,
    height,
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  });
  await image.toFile(sharpOutputPath);
  if (sharpOutputPath !== finalOutputPath) await rename(sharpOutputPath, finalOutputPath);
}

export async function createSolidFromTransparent(transparentPath: string, outputPath: string, config: EngineConfig): Promise<void> {
  const { width, height } = parseSize(config.defaultSize);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: config.defaultSolidBackground
    }
  })
    .composite([{ input: transparentPath, gravity: "center" }])
    .png()
    .toFile(outputPath);
}

export async function createTransparentFromSolid(solidPath: string, outputPath: string, config: EngineConfig): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const { data, info } = await sharp(solidPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const edgeSamples: Array<[number, number, number]> = [];
  const sampleEvery = 16;
  for (let x = 0; x < info.width; x += sampleEvery) {
    for (const y of [0, info.height - 1]) {
      const offset = (y * info.width + x) * info.channels;
      edgeSamples.push([data[offset], data[offset + 1], data[offset + 2]]);
    }
  }
  for (let y = 0; y < info.height; y += sampleEvery) {
    for (const x of [0, info.width - 1]) {
      const offset = (y * info.width + x) * info.channels;
      edgeSamples.push([data[offset], data[offset + 1], data[offset + 2]]);
    }
  }

  const configured = parseHexColor(config.defaultSolidBackground) ?? [3, 4, 5] as [number, number, number];
  const sampled = edgeSamples.length > 0
    ? edgeSamples.reduce<[number, number, number]>((sum, color) => [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2]], [0, 0, 0])
        .map((value) => Math.round(value / edgeSamples.length)) as [number, number, number]
    : configured;
  const background = colorDistance(sampled, configured) < 48 ? sampled : configured;

  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += info.channels) {
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    const distance = colorDistance([r, g, b], background);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (distance < 42 || luminance < 18) {
      out[i + 3] = 0;
    } else if (distance < 90 || luminance < 38) {
      out[i + 3] = Math.min(out[i + 3], Math.round(Math.max(distance - 42, luminance - 18) * 5));
    }
  }
  await sharp(out, { raw: info }).png().toFile(outputPath);
}

function parseHexColor(value: string): [number, number, number] | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return undefined;
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16)
  ];
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

export async function createReviewSheet(aPath: string, bPath: string, outputPath: string): Promise<void> {
  const a = await sharp(aPath).resize(512, 512, { fit: "contain" }).png().toBuffer();
  const b = await sharp(bPath).resize(512, 512, { fit: "contain" }).png().toBuffer();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp({
    create: {
      width: 1088,
      height: 544,
      channels: 4,
      background: "#101214"
    }
  })
    .composite([
      { input: a, left: 16, top: 16 },
      { input: b, left: 560, top: 16 }
    ])
    .png()
    .toFile(outputPath);
}

export async function resizePng(inputPath: string, outputPath: string, size: number): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(inputPath).resize(size, size, { fit: "contain" }).png().toFile(outputPath);
}

export async function resizeWebp(inputPath: string, outputPath: string, size: number): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(inputPath).resize(size, size, { fit: "contain" }).webp({ quality: 92 }).toFile(outputPath);
}

export async function copyLatest(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}
