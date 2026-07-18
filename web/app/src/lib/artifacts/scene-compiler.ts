import type { ResolvedArtifact, SceneManifest } from "@/lib/founders/types";
import { layoutArtifactGraph } from "./layout-registry";
import { appearanceForNode, THEME_REGISTRY } from "./material-registry";

export function compileArtifactScene(resolved: ResolvedArtifact): SceneManifest {
  const { artifact, graph } = resolved; const spatialNodes = graph.nodes.length <= 750 ? graph.nodes : [...graph.nodes].sort((left, right) => Number(right.group === artifact.definition.root) - Number(left.group === artifact.definition.root) || right.weight - left.weight).slice(0, 750);
  const spatialIds = new Set(spatialNodes.map((node) => node.id)); const spatialEdges = graph.edges.filter((edge) => spatialIds.has(edge.from) && spatialIds.has(edge.to));
  const layout = layoutArtifactGraph(spatialNodes, spatialEdges, artifact.definition); const theme = THEME_REGISTRY[artifact.definition.view.theme];
  const nodes = spatialNodes.map((node) => ({ ...node, position: layout.nodePositions[node.id] ?? [0, 0, 0] as [number, number, number], appearance: appearanceForNode(node, artifact.definition.view.theme, artifact.definition.view.textures) }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = spatialEdges.flatMap((edge) => { const from = byId.get(edge.from); const to = byId.get(edge.to); return from && to ? [{ ...edge, fromPosition: from.position, toPosition: to.position, color: theme.edge, opacity: 0.34 }] : []; });
  return { nodes, edges, layout: { id: artifact.definition.view.layout, camera: artifact.definition.view.camera, cameraTarget: layout.cameraTarget, bounds: layout.bounds }, appearance: { theme: artifact.definition.view.theme, background: theme.background }, stats: { sourceNodeCount: graph.nodes.length, renderedNodeCount: nodes.length } };
}
