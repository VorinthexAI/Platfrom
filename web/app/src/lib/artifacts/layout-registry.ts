import type { ArtifactDefinition, ArtifactLayout, SemanticGraphEdge, SemanticGraphNode } from "@/lib/founders/types";

export type Position = [number, number, number];
export type LayoutResult = { nodePositions: Record<string, Position>; cameraTarget: Position; bounds: { radius: number } };
type LayoutEngine = (nodes: SemanticGraphNode[], edges: SemanticGraphEdge[], definition: ArtifactDefinition) => Record<string, Position>;

function centerAndBounds(positions: Record<string, Position>): Pick<LayoutResult, "cameraTarget" | "bounds"> {
  const values = Object.values(positions);
  if (values.length === 0) return { cameraTarget: [0, 0, 0], bounds: { radius: 8 } };
  const target: Position = [values.reduce((sum, point) => sum + point[0], 0) / values.length, values.reduce((sum, point) => sum + point[1], 0) / values.length, values.reduce((sum, point) => sum + point[2], 0) / values.length];
  const radius = Math.max(5, ...values.map((point) => Math.hypot(point[0] - target[0], point[1] - target[1], point[2] - target[2]) + 3));
  return { cameraTarget: target, bounds: { radius } };
}

function graphLevels(nodes: SemanticGraphNode[], edges: SemanticGraphEdge[], rootGroup: string): Map<string, number> {
  const levels = new Map<string, number>();
  const roots = nodes.filter((node) => node.group === rootGroup);
  const queue = roots.map((node) => node.id); roots.forEach((node) => levels.set(node.id, 0));
  while (queue.length) {
    const current = queue.shift()!; const nextLevel = (levels.get(current) ?? 0) + 1;
    for (const edge of edges.filter((candidate) => candidate.from === current)) if (!levels.has(edge.to)) { levels.set(edge.to, nextLevel); queue.push(edge.to); }
  }
  nodes.forEach((node) => { if (!levels.has(node.id)) levels.set(node.id, 0); });
  return levels;
}

const tree: LayoutEngine = (nodes, edges, definition) => {
  const spacing = definition.view.spacing; const levels = graphLevels(nodes, edges, definition.root); const positions: Record<string, Position> = {};
  const maxLevel = Math.max(0, ...levels.values());
  for (let level = 0; level <= maxLevel; level++) {
    const row = nodes.filter((node) => levels.get(node.id) === level);
    row.forEach((node, index) => { positions[node.id] = [(index - (row.length - 1) / 2) * 3.2 * spacing, -level * 3 * spacing, 0]; });
  }
  return positions;
};

const hierarchy: LayoutEngine = (nodes, edges, definition) => Object.fromEntries(Object.entries(tree(nodes, edges, definition)).map(([id, point]) => [id, [point[0], 0, -point[1]] as Position]));
const flow: LayoutEngine = (nodes, edges, definition) => Object.fromEntries(Object.entries(tree(nodes, edges, definition)).map(([id, point]) => [id, [-point[1], point[0] * 0.55, 0] as Position]));
const layered: LayoutEngine = (nodes, edges, definition) => Object.fromEntries(Object.entries(tree(nodes, edges, definition)).map(([id, point], index) => [id, [point[0], -point[1] * 0.65, (index % 2 ? -1 : 1) * 0.45] as Position]));

const radial: LayoutEngine = (nodes, _edges, definition) => {
  const spacing = definition.view.spacing; const root = nodes.find((node) => node.group === definition.root); const rest = nodes.filter((node) => node !== root); const positions: Record<string, Position> = {};
  if (root) positions[root.id] = [0, 0, 0];
  rest.forEach((node, index) => { const angle = index / Math.max(1, rest.length) * Math.PI * 2; const radius = (4 + Math.floor(index / 12) * 3) * spacing; positions[node.id] = [Math.cos(angle) * radius, Math.sin(angle) * radius, 0]; });
  return positions;
};

const orbit: LayoutEngine = (nodes, _edges, definition) => {
  const positions: Record<string, Position> = {}; const groups = [...new Set(nodes.map((node) => node.group))];
  groups.forEach((group, groupIndex) => { const ring = nodes.filter((node) => node.group === group); const radius = groupIndex === 0 ? 0 : (3 + groupIndex * 3) * definition.view.spacing; ring.forEach((node, index) => { const angle = index / Math.max(1, ring.length) * Math.PI * 2 + groupIndex * 0.4; positions[node.id] = radius === 0 ? [0, 0, 0] : [Math.cos(angle) * radius, (groupIndex % 2 ? 0.6 : -0.6), Math.sin(angle) * radius]; }); });
  return positions;
};

const cluster: LayoutEngine = (nodes, _edges, definition) => {
  const positions: Record<string, Position> = {}; const clusters = [...new Set(nodes.map((node) => node.clusterId ?? node.group))];
  clusters.forEach((clusterId, clusterIndex) => { const angle = clusterIndex / Math.max(1, clusters.length) * Math.PI * 2; const center: Position = [Math.cos(angle) * 7 * definition.view.spacing, Math.sin(angle) * 4 * definition.view.spacing, 0]; const clusterNodes = nodes.filter((node) => (node.clusterId ?? node.group) === clusterId); clusterNodes.forEach((node, index) => { const local = index / Math.max(1, clusterNodes.length) * Math.PI * 2; positions[node.id] = [center[0] + Math.cos(local) * 1.8, center[1] + Math.sin(local) * 1.8, Math.sin(local * 2)]; }); });
  return positions;
};

const galaxy: LayoutEngine = (nodes, _edges, definition) => Object.fromEntries(nodes.map((node, index) => { const angle = index * 2.399963; const radius = Math.sqrt(index) * 1.6 * definition.view.spacing; return [node.id, [Math.cos(angle) * radius, (index % 5 - 2) * 0.3, Math.sin(angle) * radius] as Position]; }));
const force: LayoutEngine = (nodes, _edges, definition) => Object.fromEntries(nodes.map((node, index) => { const y = 1 - index / Math.max(1, nodes.length - 1) * 2; const radius = Math.sqrt(Math.max(0, 1 - y * y)); const angle = index * Math.PI * (3 - Math.sqrt(5)); const scale = 7 * definition.view.spacing; return [node.id, [Math.cos(angle) * radius * scale, y * scale * 0.7, Math.sin(angle) * radius * scale] as Position]; }));
const grid: LayoutEngine = (nodes, _edges, definition) => { const columns = Math.ceil(Math.sqrt(nodes.length)); return Object.fromEntries(nodes.map((node, index) => [node.id, [((index % columns) - (columns - 1) / 2) * 3 * definition.view.spacing, (Math.floor(index / columns) - Math.ceil(nodes.length / columns) / 2) * -3 * definition.view.spacing, 0] as Position])); };
const timeline: LayoutEngine = (nodes, _edges, definition) => Object.fromEntries([...nodes].sort((left, right) => String((left.details as Record<string, unknown>)?.createdAt ?? "").localeCompare(String((right.details as Record<string, unknown>)?.createdAt ?? ""))).map((node, index) => [node.id, [(index - (nodes.length - 1) / 2) * 3 * definition.view.spacing, 0, (index % 2 ? 1 : -1) * 0.8] as Position]));
const manual: LayoutEngine = (nodes, _edges, definition) => Object.fromEntries(nodes.map((node) => [node.id, definition.view.positions?.[node.id] ?? [0, 0, 0]]));

export const LAYOUT_REGISTRY: Record<ArtifactLayout, LayoutEngine> = { tree, cluster, galaxy, timeline, hierarchy, radial, force, grid, flow, orbit, layered, manual };

export function layoutArtifactGraph(nodes: SemanticGraphNode[], edges: SemanticGraphEdge[], definition: ArtifactDefinition): LayoutResult {
  const positions = LAYOUT_REGISTRY[definition.view.layout](nodes, edges, definition);
  return { nodePositions: positions, ...centerAndBounds(positions) };
}
