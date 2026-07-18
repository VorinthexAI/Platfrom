import type { ArtifactNodeKind, ArtifactTexture, ArtifactTheme, SemanticGraphNode } from "@/lib/founders/types";

type ThemeDefinition = { background: string; edge: string; colors: Record<ArtifactNodeKind, string>; emissive: string; opacity: number; wireframe: boolean };

const baseKinds: Record<ArtifactNodeKind, string> = { organization: "#e8edf0", scope: "#aeb8c0", member: "#737f88", agent: "#d57828", artifact: "#caa56c", metric: "#79b8c9", event: "#9b8fc7" };
export const THEME_REGISTRY: Record<ArtifactTheme, ThemeDefinition> = {
  obsidian: { background: "#070504", edge: "#7d654f", colors: baseKinds, emissive: "#35180a", opacity: 0.92, wireframe: false },
  chrome: { background: "#080a0b", edge: "#b7c0c7", colors: { ...baseKinds, organization: "#ffffff", scope: "#d6dde2", agent: "#d6a56f" }, emissive: "#11181d", opacity: 0.96, wireframe: false },
  wireframe: { background: "#030405", edge: "#8f9aa3", colors: baseKinds, emissive: "#000000", opacity: 0.8, wireframe: true },
  blueprint: { background: "#03101b", edge: "#397ca5", colors: { ...baseKinds, organization: "#d6f2ff", scope: "#75bce5", agent: "#f2a85f" }, emissive: "#05273f", opacity: 0.9, wireframe: true },
  neural: { background: "#05020b", edge: "#8256ac", colors: { ...baseKinds, organization: "#f3eaff", scope: "#af83d4", agent: "#ff8d4a" }, emissive: "#2c0d42", opacity: 0.92, wireframe: false },
  holographic: { background: "#020a0d", edge: "#45b4c7", colors: { ...baseKinds, organization: "#dbfbff", scope: "#6bd2de", agent: "#ffb46b" }, emissive: "#06333b", opacity: 0.68, wireframe: false },
  minimal: { background: "#111111", edge: "#686868", colors: { ...baseKinds, organization: "#fafafa", scope: "#c8c8c8", agent: "#e1a36b" }, emissive: "#000000", opacity: 1, wireframe: false },
  monochrome: { background: "#050505", edge: "#777777", colors: Object.fromEntries(Object.keys(baseKinds).map((kind) => [kind, "#c7c7c7"])) as Record<ArtifactNodeKind, string>, emissive: "#121212", opacity: 0.9, wireframe: false },
};

export const TEXTURE_REGISTRY: Record<ArtifactTexture, { metalness: number; roughness: number; transparent?: boolean }> = {
  "chrome-core": { metalness: 0.95, roughness: 0.16 }, "smoked-glass": { metalness: 0.25, roughness: 0.18, transparent: true },
  "brushed-silver": { metalness: 0.8, roughness: 0.42 }, "matte-graphite": { metalness: 0.3, roughness: 0.76 },
  "neural-glow": { metalness: 0.2, roughness: 0.28 }, "holographic-glass": { metalness: 0.15, roughness: 0.12, transparent: true },
  "blueprint-grid": { metalness: 0.1, roughness: 0.65 }, none: { metalness: 0.35, roughness: 0.55 },
};

const defaultTextures: Record<ArtifactNodeKind, ArtifactTexture> = { organization: "chrome-core", scope: "smoked-glass", member: "matte-graphite", agent: "brushed-silver", artifact: "holographic-glass", metric: "neural-glow", event: "blueprint-grid" };
const defaultShapes: Record<ArtifactNodeKind, "sphere" | "cube" | "ring" | "plane"> = { organization: "sphere", scope: "ring", member: "sphere", agent: "cube", artifact: "plane", metric: "sphere", event: "sphere" };

export function appearanceForNode(node: SemanticGraphNode, themeId: ArtifactTheme, textureOverrides: Partial<Record<ArtifactNodeKind, ArtifactTexture>>) {
  const theme = THEME_REGISTRY[themeId]; const stateColor = node.state === "warning" ? "#d95f4b" : node.state === "archived" ? "#596168" : theme.colors[node.kind];
  return { shape: node.appearance?.shape ?? defaultShapes[node.kind], texture: node.appearance?.texture ?? textureOverrides[node.kind] ?? defaultTextures[node.kind], scale: (node.appearance?.scale ?? 1) * Math.max(0.7, Math.min(2.2, Math.sqrt(node.weight || 1))), color: stateColor, emissive: node.state === "active" ? theme.emissive : "#000000", opacity: node.state === "archived" ? theme.opacity * 0.38 : theme.opacity, wireframe: theme.wireframe } as const;
}
