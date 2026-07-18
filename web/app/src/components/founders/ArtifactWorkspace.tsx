"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { compileArtifactScene } from "@/lib/artifacts/scene-compiler";
import { fetchArtifacts, readArtifactNode, resolveArtifact } from "@/lib/founders/client";
import type { Artifact, ArtifactLayout, ArtifactNodeDetails, ArtifactTheme, ResolvedArtifact, SceneNode } from "@/lib/founders/types";
import { SpatialArtifactCanvas } from "./SpatialArtifactCanvas";

const LAYOUTS: ArtifactLayout[] = ["tree", "cluster", "galaxy", "timeline", "hierarchy", "radial", "force", "grid", "flow", "orbit", "layered"];
const THEMES: ArtifactTheme[] = ["obsidian", "chrome", "wireframe", "blueprint", "neural", "holographic", "minimal", "monochrome"];

export function ArtifactWorkspace({ organizationKey, scopeKey }: { organizationKey: string; scopeKey: string }) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]); const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedArtifact | null>(null); const [layout, setLayout] = useState<ArtifactLayout | null>(null); const [theme, setTheme] = useState<ArtifactTheme | null>(null);
  const [selectedNode, setSelectedNode] = useState<SceneNode | null>(null); const [nodeDetails, setNodeDetails] = useState<ArtifactNodeDetails | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try { const rows = await fetchArtifacts(organizationKey, scopeKey); setError(null); setArtifacts(rows); setSelectedKey((current) => rows.some((row) => row.key === current) ? current : rows[0]?.key ?? null); if (rows.length === 0) setResolved(null); }
    catch { setError("Artifacts could not be loaded."); }
    finally { setLoading(false); }
  }, [organizationKey, scopeKey]);
  const loadArtifact = useCallback(async (key: string) => {
    try { const artifact = await resolveArtifact(key, organizationKey, scopeKey); setError(null); setResolved(artifact); setLayout((current) => current ?? artifact.artifact.definition.view.layout); setTheme((current) => current ?? artifact.artifact.definition.view.theme); }
    catch { setResolved(null); setError("Artifact graph could not be resolved."); }
  }, [organizationKey, scopeKey]);

  useEffect(() => { queueMicrotask(() => void loadList()); }, [loadList]);
  useEffect(() => { if (selectedKey) queueMicrotask(() => void loadArtifact(selectedKey)); }, [selectedKey, loadArtifact]);
  useEffect(() => {
    const source = new EventSource(`/api/founders/artifacts/stream?${new URLSearchParams({ organizationKey, scopeKey })}`);
    const invalidate = (event: MessageEvent<string>) => { const payload = JSON.parse(event.data) as { artifactKey: string }; void loadList(); if (payload.artifactKey === selectedKey) void loadArtifact(payload.artifactKey); };
    source.addEventListener("artifact.invalidated", invalidate as EventListener); return () => source.close();
  }, [organizationKey, scopeKey, selectedKey, loadArtifact, loadList]);

  const spatialResolved = useMemo(() => resolved ? { ...resolved, artifact: { ...resolved.artifact, definition: { ...resolved.artifact.definition, view: { ...resolved.artifact.definition.view, layout: layout ?? resolved.artifact.definition.view.layout, theme: theme ?? resolved.artifact.definition.view.theme } } } } : null, [resolved, layout, theme]);
  const manifest = useMemo(() => spatialResolved ? compileArtifactScene(spatialResolved) : null, [spatialResolved]);
  const layoutOptions = useMemo(() => resolved?.artifact.definition.view.positions ? [...LAYOUTS, "manual" as const] : LAYOUTS, [resolved]);
  const selectNode = useCallback(async (node: SceneNode) => {
    if (!resolved) return; setSelectedNode(node); setNodeDetails(null);
    try { setNodeDetails(await readArtifactNode(resolved.artifact.key, organizationKey, scopeKey, node.ref)); }
    catch { setNodeDetails({ ref: node.ref, details: node.details, revision: resolved.revisions[node.group] ?? "unknown" }); }
  }, [resolved, organizationKey, scopeKey]);

  return <div className="relative h-full min-h-0 overflow-hidden">
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-center gap-2 p-4 sm:p-6">
      <div className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto">{artifacts.map((artifact) => <button key={artifact.key} type="button" onClick={() => { setSelectedKey(artifact.key); setLayout(null); setTheme(null); setSelectedNode(null); }} className={`whitespace-nowrap rounded-full border px-4 py-2 text-xs backdrop-blur-md ${artifact.key === selectedKey ? "border-[#d57828]/60 bg-[#d57828]/15 text-silver-50" : "border-white/10 bg-black/30 text-silver-400"}`}>{artifact.name}</button>)}</div>
      {manifest ? <><span className="pointer-events-auto rounded-full border border-white/10 bg-black/30 px-3 py-2 font-mono text-[0.58rem] text-silver-400 backdrop-blur-md">{manifest.stats.renderedNodeCount}/{manifest.stats.sourceNodeCount} nodes</span><select aria-label="Spatial layout" value={manifest.layout.id} onChange={(event) => setLayout(event.target.value as ArtifactLayout)} className="founders-surface pointer-events-auto rounded-full border border-white/10 px-3 py-2 text-xs text-silver-100 outline-none">{layoutOptions.map((id) => <option key={id} value={id}>{id}</option>)}</select><select aria-label="Visual theme" value={manifest.appearance.theme} onChange={(event) => setTheme(event.target.value as ArtifactTheme)} className="founders-surface pointer-events-auto rounded-full border border-white/10 px-3 py-2 text-xs text-silver-100 outline-none">{THEMES.map((id) => <option key={id} value={id}>{id}</option>)}</select></> : null}
    </div>
    {manifest ? <SpatialArtifactCanvas manifest={manifest} selectedId={selectedNode?.id ?? null} onSelect={selectNode} /> : null}
    {loading ? <p className="absolute inset-0 grid place-items-center micro-label text-silver-400">Compiling artifact graph…</p> : null}
    {error ? <p className="absolute inset-0 grid place-items-center text-base text-silver-100">{error}</p> : null}
    {!loading && !error && artifacts.length === 0 ? <div className="absolute inset-0 flex flex-col items-center justify-center text-center"><h1 className="font-display text-2xl tracking-[0.12em] text-silver-50">Spatial artifacts</h1><p className="mt-3 max-w-md text-sm leading-relaxed text-silver-300">Semantic graph artifacts created inside Nexus will appear here.</p></div> : null}
    {selectedNode ? <aside className="founders-surface absolute inset-x-4 bottom-4 z-20 max-h-[42%] overflow-auto rounded-2xl border border-white/10 p-5 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[360px]" aria-live="polite">
      <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[0.58rem] tracking-[0.16em] text-silver-500 uppercase">{selectedNode.kind} · {selectedNode.state}</p><h2 className="mt-2 text-lg text-silver-50">{selectedNode.label}</h2></div><button type="button" onClick={() => { setSelectedNode(null); setNodeDetails(null); }} className="text-silver-400 hover:text-silver-50" aria-label="Close node details">×</button></div>
      <p className="mt-2 break-all font-mono text-[0.6rem] text-silver-500">{selectedNode.ref.nodeType}/{selectedNode.ref.nodeKey}</p>
      <pre className="mt-4 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-silver-300">{JSON.stringify(nodeDetails?.details ?? selectedNode.details, null, 2)}</pre>
    </aside> : null}
  </div>;
}
