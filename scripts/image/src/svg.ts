import { mkdir } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "./filesystem";
import type { EngineConfig } from "./types";
import { rel } from "./utils";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function createSvgFromPng(input: {
  config: EngineConfig;
  pngPath: string;
  svgPath: string;
  title: string;
  solidBackground?: string;
}): Promise<string> {
  await mkdir(path.dirname(input.svgPath), { recursive: true });
  const bytes = await Bun.file(input.pngPath).bytes();
  const base64 = Buffer.from(bytes).toString("base64");
  const background = input.solidBackground
    ? `  <rect width="1024" height="1024" fill="${escapeXml(input.solidBackground)}"/>\n`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="${escapeXml(input.title)}">
  <title>${escapeXml(input.title)}</title>
${background}  <image href="data:image/png;base64,${base64}" width="1024" height="1024" preserveAspectRatio="xMidYMid meet"/>
</svg>
`;
  await atomicWrite(input.svgPath, svg);
  return rel(input.config.rootDir, input.svgPath);
}

export async function createLogoSvgs(input: {
  config: EngineConfig;
  assetName: string;
  solidPath?: string;
  transparentPath?: string;
}): Promise<{ solidSvgPath?: string; transparentSvgPath?: string }> {
  const result: { solidSvgPath?: string; transparentSvgPath?: string } = {};
  if (input.transparentPath) {
    const pngPath = path.join(input.config.rootDir, input.transparentPath);
    const svgPath = pngPath.replace(/\.png$/i, ".svg");
    result.transparentSvgPath = await createSvgFromPng({
      config: input.config,
      pngPath,
      svgPath,
      title: `${input.assetName} transparent logo`
    });
  }
  if (input.solidPath) {
    const pngPath = path.join(input.config.rootDir, input.solidPath);
    const svgPath = pngPath.replace(/\.png$/i, ".svg");
    result.solidSvgPath = await createSvgFromPng({
      config: input.config,
      pngPath,
      svgPath,
      title: `${input.assetName} solid logo`,
      solidBackground: input.config.defaultSolidBackground
    });
  }
  return result;
}
