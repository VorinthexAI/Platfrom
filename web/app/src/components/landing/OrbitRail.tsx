"use client";

import { useEffect, useRef, useState } from "react";
import { getEntityById } from "@/lib/galaxy/registry-helpers";
import { trackCtaClick } from "@/lib/analytics";
import {
  ORBIT_STEPS,
  syncEntityUrl,
  useGalaxyStore,
} from "@/lib/galaxy-store";

interface ScopeStop {
  name: string;
  kind: "overview" | "product" | "child";
  stepIndex: number;
  path: string;
  parent?: string;
}

const scopeStops: ScopeStop[] = ORBIT_STEPS.map((step, stepIndex) => {
  const entity = step.entityId ? getEntityById(step.entityId) : undefined;
  return {
    name: entity?.name ?? "Nexus",
    kind: step.kind,
    stepIndex,
    path: step.path,
    parent: step.product ?? undefined,
  };
});

/**
 * Vertical orbit rail on the right edge. Accordion behavior: the focused
 * product expands its children as smaller sub-dots directly beneath it;
 * moving to another product collapses the previous one, so the rail never
 * grows past one open parent.
 */
export function OrbitRail() {
  const step = useGalaxyStore((s) => s.step);
  const mode = useGalaxyStore((s) => s.mode);
  const setStep = useGalaxyStore((s) => s.setStep);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  if (mode === "cave" || mode === "jump" || mode === "intro") return null;

  const go = (stepIndex: number, path: string) => {
    trackCtaClick("orbit_rail", { step_index: stepIndex, route: path });
    setStep(stepIndex);
    syncEntityUrl(path);
    setOpen(false);
  };

  const current = scopeStops[step] ?? scopeStops[0];
  const matches = scopeStops.filter((scope) =>
    `${scope.name} ${scope.parent ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const previous = (step - 1 + ORBIT_STEPS.length) % ORBIT_STEPS.length;
  const next = (step + 1) % ORBIT_STEPS.length;

  return (
    <nav
      aria-label="Scopes"
      className={`absolute top-5 left-5 z-50 transition-opacity duration-500 sm:top-7 sm:left-10 ${
        mode === "belt" ? "pointer-events-none opacity-25" : "opacity-100"
      }`}
    >
      <div ref={pickerRef} className="relative flex items-center gap-1">
        <div className="relative">
          <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
            className="flex min-w-48 items-center justify-between gap-8 rounded-full border border-white/15 bg-black/70 px-4 py-2.5 text-left shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <span>
              <span className="block font-mono text-[0.45rem] tracking-[0.28em] text-silver-600 uppercase">Scope</span>
              <span className="mt-1 block font-display text-[0.72rem] tracking-[0.2em] text-silver-100 uppercase">{current.name}</span>
            </span>
            <span className="text-silver-500">⌄</span>
          </button>
          {open ? (
            <div className="absolute top-[calc(100%+0.55rem)] left-0 w-72 rounded-2xl border border-white/15 bg-[#080a0c]/95 p-2 shadow-2xl backdrop-blur-2xl">
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search scopes..."
                className="mb-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[0.62rem] tracking-[0.12em] text-silver-100 outline-none placeholder:text-silver-700 focus:border-white/25" />
              <div className="max-h-72 overflow-y-auto">
                {matches.map((scope) => (
                  <button key={scope.stepIndex} type="button" onClick={() => go(scope.stepIndex, scope.path)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-mono text-[0.58rem] tracking-[0.14em] uppercase transition-colors hover:bg-white/[0.07] ${scope.stepIndex === step ? "text-silver-50" : "text-silver-500"}`}>
                    <span>{scope.name}</span><span className="text-[0.45rem] text-silver-700">{scope.kind}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <button type="button" aria-label="Previous scope" onClick={() => go(previous, ORBIT_STEPS[previous].path)} className="grid h-9 w-8 place-items-center rounded-full border border-white/12 bg-black/60 text-silver-500 transition-colors hover:border-white/30 hover:text-silver-100">‹</button>
        <button type="button" aria-label="Next scope" onClick={() => go(next, ORBIT_STEPS[next].path)} className="grid h-9 w-8 place-items-center rounded-full border border-white/12 bg-black/60 text-silver-500 transition-colors hover:border-white/30 hover:text-silver-100">›</button>
      </div>
    </nav>
  );
}
