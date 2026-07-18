"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { CloseIcon } from "@vorinthex/shared/ui/icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { compileArtifactScene } from "@/lib/artifacts/scene-compiler";
import { fetchArtifacts, readArtifactNode, resolveArtifact } from "@/lib/founders/client";
import type { Artifact, ArtifactLayout, ArtifactNodeDetails, ArtifactTheme, ResolvedArtifact, SceneNode } from "@/lib/founders/types";
import { SpatialArtifactCanvas } from "./SpatialArtifactCanvas";

const LAYOUTS: ArtifactLayout[] = ["tree", "cluster", "galaxy", "timeline", "hierarchy", "radial", "force", "grid", "flow", "orbit", "layered"];
const THEMES: ArtifactTheme[] = ["obsidian", "chrome", "wireframe", "blueprint", "neural", "holographic", "minimal", "monochrome"];

type ArtifactInvalidation = { artifactKey: string; reason: "created" | "updated" | "deleted" };

export function ArtifactWorkspace({ organizationKey, scopeKey, open, onOpenChange }: { organizationKey: string; scopeKey: string; open: boolean; onOpenChange(open: boolean): void }) {
  const reducedMotion = useReducedMotion();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedArtifact | null>(null);
  const [layout, setLayout] = useState<ArtifactLayout | null>(null);
  const [theme, setTheme] = useState<ArtifactTheme | null>(null);
  const [selectedNode, setSelectedNode] = useState<SceneNode | null>(null);
  const [nodeDetails, setNodeDetails] = useState<ArtifactNodeDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async (preferredKey?: string) => {
    try {
      const rows = await fetchArtifacts(organizationKey, scopeKey);
      setError(null);
      setArtifacts(rows);
      setSelectedKey((current) => preferredKey && rows.some((row) => row.key === preferredKey)
        ? preferredKey
        : rows.some((row) => row.key === current) ? current : rows[0]?.key ?? null);
      if (rows.length === 0) setResolved(null);
    } catch {
      setError("Artifacts could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [organizationKey, scopeKey]);

  const loadArtifact = useCallback(async (key: string) => {
    try {
      const artifact = await resolveArtifact(key, organizationKey, scopeKey);
      setError(null);
      setResolved(artifact);
      setLayout(artifact.artifact.definition.view.layout);
      setTheme(artifact.artifact.definition.view.theme);
    } catch {
      setResolved(null);
      setError("Artifact graph could not be resolved.");
    }
  }, [organizationKey, scopeKey]);

  useEffect(() => { queueMicrotask(() => void loadList()); }, [loadList]);
  useEffect(() => { if (selectedKey) queueMicrotask(() => void loadArtifact(selectedKey)); }, [selectedKey, loadArtifact]);
  useEffect(() => {
    const source = new EventSource(`/api/founders/artifacts/stream?${new URLSearchParams({ organizationKey, scopeKey })}`);
    const invalidate = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as ArtifactInvalidation;
      if (payload.reason === "created") {
        setSelectedNode(null);
        setNodeDetails(null);
        void loadList(payload.artifactKey);
        onOpenChange(true);
        return;
      }
      void loadList();
      if (payload.artifactKey === selectedKey && payload.reason !== "deleted") void loadArtifact(payload.artifactKey);
    };
    source.addEventListener("artifact.invalidated", invalidate as EventListener);
    return () => source.close();
  }, [organizationKey, scopeKey, selectedKey, loadArtifact, loadList, onOpenChange]);

  const spatialResolved = useMemo(() => resolved ? {
    ...resolved,
    artifact: {
      ...resolved.artifact,
      definition: {
        ...resolved.artifact.definition,
        view: {
          ...resolved.artifact.definition.view,
          layout: layout ?? resolved.artifact.definition.view.layout,
          theme: theme ?? resolved.artifact.definition.view.theme,
        },
      },
    },
  } : null, [resolved, layout, theme]);
  const manifest = useMemo(() => spatialResolved ? compileArtifactScene(spatialResolved) : null, [spatialResolved]);
  const layoutOptions = useMemo(() => resolved?.artifact.definition.view.positions ? [...LAYOUTS, "manual" as const] : LAYOUTS, [resolved]);

  const selectArtifact = useCallback((key: string) => {
    setSelectedKey(key);
    setLayout(null);
    setTheme(null);
    setSelectedNode(null);
    setNodeDetails(null);
  }, []);

  const selectNode = useCallback(async (node: SceneNode) => {
    if (!resolved) return;
    setSelectedNode(node);
    setNodeDetails(null);
    try {
      setNodeDetails(await readArtifactNode(resolved.artifact.key, organizationKey, scopeKey, node.ref));
    } catch {
      setNodeDetails({ ref: node.ref, details: node.details, revision: resolved.revisions[node.group] ?? "unknown" });
    }
  }, [resolved, organizationKey, scopeKey]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reducedMotion ? 0.12 : 0.28 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.section
                aria-label="Spatial artifacts"
                className="fixed inset-x-2 top-2 bottom-2 z-50 overflow-hidden rounded-[1.75rem] border border-white/12 bg-[#090b0d] shadow-[0_28px_100px_rgba(0,0,0,0.7)] outline-none sm:inset-x-4 sm:top-4 sm:bottom-4 lg:right-5 lg:left-[300px]"
                initial={reducedMotion ? { opacity: 0 } : { y: "-105%", opacity: 0.7, scale: 0.985 }}
                animate={reducedMotion ? { opacity: 1 } : { y: 0, opacity: 1, scale: 1 }}
                exit={reducedMotion ? { opacity: 0 } : { y: "-105%", opacity: 0.6, scale: 0.985 }}
                transition={reducedMotion ? { duration: 0.15 } : { duration: 0.62, ease: [0.16, 1, 0.3, 1] }}
              >
                <Dialog.Title className="sr-only">Spatial artifacts</Dialog.Title>
                <Dialog.Description className="sr-only">Explore live semantic graph artifacts for the selected Nexus scope.</Dialog.Description>

                <header className="absolute inset-x-0 top-0 z-30 flex min-h-16 items-center gap-3 border-b border-white/8 bg-[#090b0d]/80 px-4 py-3 backdrop-blur-xl sm:px-5">
                  <div className="min-w-0 shrink-0">
                    <p className="font-mono text-[0.55rem] tracking-[0.2em] text-[#d98a43] uppercase">Artifact</p>
                    <p className="max-w-40 truncate text-sm text-silver-50 sm:max-w-64">{resolved?.artifact.name ?? "Spatial canvas"}</p>
                  </div>
                  <div className="scrollbar-hide flex min-w-0 flex-1 gap-2 overflow-x-auto px-1">
                    {artifacts.map((artifact) => (
                      <button key={artifact.key} type="button" onClick={() => selectArtifact(artifact.key)} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[0.68rem] transition-colors ${artifact.key === selectedKey ? "border-[#d57828]/60 bg-[#d57828]/15 text-silver-50" : "border-white/10 bg-white/[0.025] text-silver-400 hover:border-white/20 hover:text-silver-100"}`}>
                        {artifact.name}
                      </button>
                    ))}
                  </div>
                  {manifest ? <span className="hidden shrink-0 font-mono text-[0.58rem] text-silver-500 xl:inline">{manifest.stats.renderedNodeCount}/{manifest.stats.sourceNodeCount} nodes</span> : null}
                  {manifest ? (
                    <div className="hidden shrink-0 items-center gap-2 sm:flex">
                      <select aria-label="Spatial layout" value={manifest.layout.id} onChange={(event) => setLayout(event.target.value as ArtifactLayout)} className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-silver-100 outline-none">{layoutOptions.map((id) => <option key={id} value={id}>{id}</option>)}</select>
                      <select aria-label="Visual theme" value={manifest.appearance.theme} onChange={(event) => setTheme(event.target.value as ArtifactTheme)} className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-silver-100 outline-none">{THEMES.map((id) => <option key={id} value={id}>{id}</option>)}</select>
                    </div>
                  ) : null}
                  <Dialog.Close asChild>
                    <button type="button" aria-label="Close artifact" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-silver-300 transition-colors hover:border-white/25 hover:text-silver-50">
                      <CloseIcon size="sm" />
                    </button>
                  </Dialog.Close>
                </header>

                <div className="absolute inset-x-0 top-16 bottom-0 overflow-hidden">
                  {manifest ? <SpatialArtifactCanvas manifest={manifest} selectedId={selectedNode?.id ?? null} onSelect={selectNode} /> : null}
                  {loading ? <p className="absolute inset-0 grid place-items-center micro-label text-silver-400">Compiling artifact graph…</p> : null}
                  {error ? <p className="absolute inset-0 grid place-items-center text-base text-silver-100">{error}</p> : null}
                  {!loading && !error && artifacts.length === 0 ? <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"><h1 className="font-display text-2xl tracking-[0.12em] text-silver-50">Spatial artifacts</h1><p className="mt-3 max-w-md text-sm leading-relaxed text-silver-300">Semantic graph artifacts created inside Nexus will appear here.</p></div> : null}
                  {selectedNode ? <aside className="founders-surface absolute inset-x-4 bottom-4 z-20 max-h-[42%] overflow-auto rounded-2xl border border-white/10 p-5 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[360px]" aria-live="polite">
                    <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[0.58rem] tracking-[0.16em] text-silver-500 uppercase">{selectedNode.kind} · {selectedNode.state}</p><h2 className="mt-2 text-lg text-silver-50">{selectedNode.label}</h2></div><button type="button" onClick={() => { setSelectedNode(null); setNodeDetails(null); }} className="text-silver-400 hover:text-silver-50" aria-label="Close node details">×</button></div>
                    <p className="mt-2 break-all font-mono text-[0.6rem] text-silver-500">{selectedNode.ref.nodeType}/{selectedNode.ref.nodeKey}</p>
                    <pre className="mt-4 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-silver-300">{JSON.stringify(nodeDetails?.details ?? selectedNode.details, null, 2)}</pre>
                  </aside> : null}
                </div>
              </motion.section>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
