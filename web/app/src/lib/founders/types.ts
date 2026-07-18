export type AccessibleOrganizationOption = {
  key: string;
  name: string;
  alias: string | null;
};

export type AccessibleScopeOption = {
  key: string;
  name: string;
  position: number;
  parentKey: string | null;
  path: string[];
};

export type FoundersAccount = {
  user: { key: string; name: string | null; alias: string | null; email: string };
  rootOrganization: { key: string; name: string; alias: string | null };
  rootMembership: { role: string; title: string | null };
  applicationRole: string;
};

export type BeaconStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

export type ArtifactValue = string | number | boolean | null | ArtifactValue[] | { [key: string]: ArtifactValue };
export type ArtifactLayout = "tree" | "cluster" | "galaxy" | "timeline" | "hierarchy" | "radial" | "force" | "grid" | "flow" | "orbit" | "layered" | "manual";
export type ArtifactTheme = "obsidian" | "chrome" | "wireframe" | "blueprint" | "neural" | "holographic" | "minimal" | "monochrome";
export type ArtifactTexture = "chrome-core" | "smoked-glass" | "brushed-silver" | "matte-graphite" | "neural-glow" | "holographic-glass" | "blueprint-grid" | "none";
export type ArtifactNodeKind = "organization" | "scope" | "member" | "agent" | "artifact" | "metric" | "event";
export type SceneNodeRef = { nodeType: string; nodeKey: string };
export type ArtifactDefinition = {
  version: 1;
  mode: "live" | "snapshot";
  root: string;
  nodes: Record<string, { binding: string; kind: ArtifactNodeKind; appearance?: { shape?: "sphere" | "cube" | "ring" | "plane"; texture?: ArtifactTexture; scale?: number } }>;
  edges: Array<{ from: string; to: string; relation: string; directed: boolean }>;
  bindings: Record<string, { kind: string }>;
  view: { layout: ArtifactLayout; theme: ArtifactTheme; camera: "perspective" | "orthographic"; textures: Partial<Record<ArtifactNodeKind, ArtifactTexture>>; spacing: number; positions?: Record<string, [number, number, number]> };
  actions?: Record<string, { actionId: string; label: string }>;
};
export type Artifact = {
  key: string;
  organizationKey: string;
  scopeKey: string;
  name: string;
  definition: ArtifactDefinition;
  schemaVersion: 1;
  snapshotKey: string | null;
  createdAt: string;
  updatedAt: string;
};
export type SemanticGraphNode = { id: string; ref: SceneNodeRef; group: string; kind: ArtifactNodeKind; label: string; state: "default" | "active" | "archived" | "warning"; weight: number; parentRef: SceneNodeRef | null; clusterId: string | null; appearance?: { shape?: "sphere" | "cube" | "ring" | "plane"; texture?: ArtifactTexture; scale?: number }; details: ArtifactValue };
export type SemanticGraphEdge = { id: string; from: string; to: string; relation: string; directed: boolean };
export type ResolvedArtifact = { artifact: Artifact; graph: { nodes: SemanticGraphNode[]; edges: SemanticGraphEdge[] }; revisions: Record<string, string> };
export type SceneNode = SemanticGraphNode & { position: [number, number, number]; appearance: { shape: "sphere" | "cube" | "ring" | "plane"; texture: ArtifactTexture; scale: number; color: string; emissive: string; opacity: number; wireframe: boolean } };
export type SceneEdge = SemanticGraphEdge & { fromPosition: [number, number, number]; toPosition: [number, number, number]; color: string; opacity: number };
export type SceneManifest = { nodes: SceneNode[]; edges: SceneEdge[]; layout: { id: ArtifactLayout; camera: "perspective" | "orthographic"; cameraTarget: [number, number, number]; bounds: { radius: number } }; appearance: { theme: ArtifactTheme; background: string }; stats: { sourceNodeCount: number; renderedNodeCount: number } };
export type ArtifactNodeDetails = { ref: SceneNodeRef; details: ArtifactValue; revision: string };
