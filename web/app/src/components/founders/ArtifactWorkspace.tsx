"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchArtifacts, resolveArtifact } from "@/lib/founders/client";
import type { Artifact, ArtifactBinding, ArtifactFormat, ArtifactLayoutNode, ArtifactValue, ResolvedArtifact } from "@/lib/founders/types";

type Props = { organizationKey: string; scopeKey: string };

function formatValue(value: ArtifactValue, format?: ArtifactFormat): string {
  if (value === null || value === undefined) return "—";
  if (!format) return typeof value === "object" ? JSON.stringify(value) : String(value);
  try {
    if (format.type === "currency" && typeof value === "number") return new Intl.NumberFormat(format.locale, { style: "currency", currency: format.currency, notation: format.compact ? "compact" : "standard" }).format(value);
    if (format.type === "number" && typeof value === "number") return new Intl.NumberFormat(format.locale, { notation: format.compact ? "compact" : "standard", maximumFractionDigits: format.maximumFractionDigits }).format(value);
    if (format.type === "percent" && typeof value === "number") return new Intl.NumberFormat(format.locale, { style: "percent", maximumFractionDigits: format.maximumFractionDigits }).format(value);
    if (format.type === "date" && typeof value === "string") return new Intl.DateTimeFormat(format.locale, { dateStyle: format.dateStyle ?? "medium" }).format(new Date(value));
    if (format.type === "text") return `${format.prefix ?? ""}${String(value)}${format.suffix ?? ""}`;
  } catch { return String(value); }
  return String(value);
}

function Table({ value }: { value: ArtifactValue }) {
  if (!Array.isArray(value) || value.length === 0) return <p className="text-sm text-silver-500">No rows</p>;
  const rows = value.filter((row): row is Record<string, ArtifactValue> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  if (rows.length === 0) return <pre className="overflow-auto text-xs text-silver-300">{JSON.stringify(value, null, 2)}</pre>;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 12);
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-white/10">{columns.map((column) => <th key={column} className="px-3 py-2 font-mono text-[0.6rem] tracking-[0.14em] text-silver-500 uppercase">{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-b border-white/5">{columns.map((column) => <td key={column} className="px-3 py-3 text-silver-200">{formatValue(row[column] ?? null)}</td>)}</tr>)}</tbody></table></div>;
}

function Graph({ value }: { value: ArtifactValue }) {
  if (!Array.isArray(value)) return <p className="text-sm text-silver-500">Graph data is unavailable</p>;
  const points = value.map((item, index) => {
    if (typeof item === "number") return { label: String(index + 1), value: item };
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const numeric = Object.values(item).find((field) => typeof field === "number");
      const label = Object.values(item).find((field) => typeof field === "string");
      return typeof numeric === "number" ? { label: String(label ?? index + 1), value: numeric } : null;
    }
    return null;
  }).filter((point): point is { label: string; value: number } => point !== null);
  const max = Math.max(...points.map((point) => Math.abs(point.value)), 1);
  return <div className="space-y-3">{points.map((point, index) => <div key={`${point.label}-${index}`} className="grid grid-cols-[100px_1fr_auto] items-center gap-3 text-xs"><span className="truncate text-silver-400">{point.label}</span><span className="h-2 overflow-hidden rounded-full bg-white/5"><span className="block h-full rounded-full bg-[#d57828]" style={{ width: `${Math.max(2, Math.abs(point.value) / max * 100)}%` }} /></span><span className="font-mono text-silver-200">{point.value}</span></div>)}</div>;
}

function ArtifactNode({ node, artifact }: { node: ArtifactLayoutNode; artifact: ResolvedArtifact }) {
  const value = node.binding ? artifact.resolved[node.binding] ?? null : null;
  const binding = node.binding ? artifact.artifact.definition.bindings[node.binding] as ArtifactBinding | undefined : undefined;
  const children = node.children?.map((child, index) => <ArtifactNode key={child.key ?? `${child.type}-${index}`} node={child} artifact={artifact} />);
  const style = node.presentation?.span ? { gridColumn: `span ${node.presentation.span} / span ${node.presentation.span}` } : undefined;
  if (node.type === "grid") return <div className="grid gap-4 md:grid-cols-12" style={style}>{children}</div>;
  if (node.type === "stack") return <div className="space-y-4" style={style}>{children}</div>;
  if (node.type === "section") return <section className="rounded-2xl border border-white/8 bg-black/15 p-5" style={style}>{node.title ? <h2 className="mb-4 text-sm tracking-[0.08em] text-silver-100">{node.title}</h2> : null}{children}</section>;
  if (node.type === "heading") return <h2 className="font-display text-xl tracking-[0.08em] text-silver-50" style={style}>{node.title ?? formatValue(value, binding?.format)}</h2>;
  if (node.type === "metric") return <div className="rounded-2xl border border-white/8 bg-black/20 p-5" style={style}><p className="font-mono text-[0.6rem] tracking-[0.16em] text-silver-500 uppercase">{node.title ?? node.binding}</p><p className="mt-2 text-2xl text-silver-50">{formatValue(value, binding?.format)}</p></div>;
  if (node.type === "table") return <section className="rounded-2xl border border-white/8 bg-black/20 p-4" style={style}>{node.title ? <h2 className="mb-3 text-sm text-silver-100">{node.title}</h2> : null}<Table value={value} /></section>;
  if (node.type === "graph") return <section className="rounded-2xl border border-white/8 bg-black/20 p-5" style={style}>{node.title ? <h2 className="mb-4 text-sm text-silver-100">{node.title}</h2> : null}<Graph value={value} /></section>;
  if (node.type === "timeline") return <section className="space-y-3" style={style}>{node.title ? <h2 className="text-sm text-silver-100">{node.title}</h2> : null}{Array.isArray(value) ? value.map((item, index) => <div key={index} className="border-l border-[#d57828]/50 py-1 pl-4 text-sm text-silver-200">{formatValue(item)}</div>) : formatValue(value)}</section>;
  if (node.type === "form") return <section className="rounded-2xl border border-white/8 bg-black/20 p-5 text-sm text-silver-300" style={style}>{node.title ?? "Form"}{children}</section>;
  if (node.type === "artifact") return <section className="rounded-2xl border border-white/8 p-4" style={style}>{node.title ? <h2 className="mb-3 text-sm text-silver-100">{node.title}</h2> : null}{value && typeof value === "object" ? <pre className="overflow-auto text-xs text-silver-300">{JSON.stringify(value, null, 2)}</pre> : formatValue(value)}</section>;
  return <p className="text-base leading-relaxed text-silver-200" style={style}>{node.title ? <span className="mr-2 text-silver-400">{node.title}</span> : null}{node.binding ? formatValue(value, binding?.format) : null}{children}</p>;
}

export function ArtifactWorkspace({ organizationKey, scopeKey }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try { const rows = await fetchArtifacts(organizationKey, scopeKey); setError(null); setArtifacts(rows); setSelectedKey((current) => rows.some((row) => row.key === current) ? current : rows[0]?.key ?? null); if (rows.length === 0) setResolved(null); }
    catch { setError("Artifacts could not be loaded."); }
    finally { setLoading(false); }
  }, [organizationKey, scopeKey]);
  const loadArtifact = useCallback(async (key: string) => {
    try { const artifact = await resolveArtifact(key, organizationKey, scopeKey); setError(null); setResolved(artifact); }
    catch { setResolved(null); setError("Artifact could not be resolved."); }
  }, [organizationKey, scopeKey]);

  useEffect(() => { queueMicrotask(() => void loadList()); }, [loadList]);
  useEffect(() => { if (selectedKey) queueMicrotask(() => void loadArtifact(selectedKey)); }, [selectedKey, loadArtifact]);
  useEffect(() => {
    const query = new URLSearchParams({ organizationKey, scopeKey }); const source = new EventSource(`/api/founders/artifacts/stream?${query}`);
    const invalidate = (event: MessageEvent<string>) => { const payload = JSON.parse(event.data) as { artifactKey: string }; void loadList(); if (payload.artifactKey === selectedKey) void loadArtifact(payload.artifactKey); };
    source.addEventListener("artifact.invalidated", invalidate as EventListener); return () => source.close();
  }, [organizationKey, scopeKey, selectedKey, loadArtifact, loadList]);

  const selected = useMemo(() => artifacts.find((artifact) => artifact.key === selectedKey) ?? null, [artifacts, selectedKey]);
  return <div className="scrollbar-hide h-full overflow-y-auto px-4 pb-16 sm:px-8"><div className="mx-auto w-full max-w-[1040px] pt-8 sm:pt-12">
    <div className="mb-8 flex flex-wrap items-center gap-2">{artifacts.map((artifact) => <button key={artifact.key} type="button" onClick={() => setSelectedKey(artifact.key)} className={`rounded-full border px-4 py-2 text-xs transition-colors ${artifact.key === selectedKey ? "border-[#d57828]/60 bg-[#d57828]/10 text-silver-50" : "border-white/10 bg-black/10 text-silver-400 hover:border-white/20"}`}>{artifact.name}</button>)}</div>
    {loading ? <p className="micro-label text-silver-400">Loading artifacts…</p> : null}
    {error ? <p className="text-base text-silver-100">{error}</p> : null}
    {!loading && !error && artifacts.length === 0 ? <div className="flex min-h-[45svh] flex-col items-center justify-center text-center"><h1 className="font-display text-2xl tracking-[0.12em] text-silver-50">Artifacts</h1><p className="mt-3 max-w-md text-sm leading-relaxed text-silver-300">Live, permission-aware views created inside Nexus will appear here.</p></div> : null}
    {resolved && selected ? <article aria-live="polite"><header className="mb-7 flex items-end justify-between gap-4"><div><p className="font-mono text-[0.6rem] tracking-[0.16em] text-silver-500 uppercase">{selected.definition.renderer}</p><h1 className="mt-2 font-display text-2xl tracking-[0.08em] text-silver-50">{selected.name}</h1></div><span className="rounded-full border border-white/10 px-3 py-1 font-mono text-[0.55rem] tracking-[0.14em] text-silver-400 uppercase">{selected.definition.mode}</span></header><ArtifactNode node={resolved.artifact.definition.layout} artifact={resolved} /></article> : null}
  </div></div>;
}
