"use client";

import { useEffect, useRef, type WheelEvent } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "@vorinthex/shared/ui/icons";
import { entityAudioUrl, orchestratorMessageUrl, useAudioStore } from "@/lib/audio/audio-store";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { entityLogoUrl } from "@/lib/three/entity-logo";
import { SpeakerIcon } from "@/components/ui/SpeakerIcon";

const ORCHESTRATORS = Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators);
const ORCHESTRATOR_BY_ID = new Map(ORCHESTRATORS.map((entity) => [entity.id, entity]));

function orchestratorDepth(entity: GalaxyEntity) {
  let depth = 0;
  let current = entity;
  while (current.reportsTo) {
    const parent = ORCHESTRATOR_BY_ID.get(current.reportsTo);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

const CORE = VORINTHEX_GALAXY_REGISTRY.products.core;
const CAPABILITIES = (CORE.children ?? [])
  .map((id) => Object.values(VORINTHEX_GALAXY_REGISTRY.capabilities).find((entity) => entity.id === id))
  .filter((entity): entity is GalaxyEntity => Boolean(entity));
const ENTITY_LAYERS: Array<{ name: string; entities: GalaxyEntity[] }> = [
  { name: "Core", entities: [CORE] },
  { name: "Capabilities", entities: CAPABILITIES },
  { name: "Products", entities: [VORINTHEX_GALAXY_REGISTRY.products.launch, VORINTHEX_GALAXY_REGISTRY.products.studio] },
  { name: "Atlas", entities: [VORINTHEX_GALAXY_REGISTRY.orchestrators.atlas] },
  { name: "Executive", entities: ORCHESTRATORS.filter((entity) => orchestratorDepth(entity) === 1) },
  { name: "Departments", entities: ORCHESTRATORS.filter((entity) => orchestratorDepth(entity) === 2) },
  { name: "Agents", entities: ORCHESTRATORS.filter((entity) => orchestratorDepth(entity) === 3) },
];

function descriptionFor(entity: GalaxyEntity) {
  return entity.content?.drawerLine ?? entity.shortDescription ?? entity.tagline ?? entity.label ?? entity.type;
}

function downwardArcTransform(index: number, center: number, depth: number, radius: number, rotation: number, scale = 1) {
  const position = Math.max(-1, Math.min(1, (index - center) / radius));
  const offset = depth * (1 - position * position);
  return `translateY(${offset}px) rotate(${position * -rotation}deg) scale(${scale})`;
}

interface NexusEntityArcProps {
  selectedEntityId: string;
  onSelect: (entity: GalaxyEntity) => void;
  onEnter: (entity: GalaxyEntity) => void;
}

export function NexusEntityArc({ selectedEntityId, onSelect, onEnter }: NexusEntityArcProps) {
  const wheelAt = useRef(0);
  const playVoice = useAudioStore((state) => state.playVoice);
  const layerIndex = Math.max(0, ENTITY_LAYERS.findIndex((layer) => layer.entities.some((entity) => entity.id === selectedEntityId)));
  const layer = ENTITY_LAYERS[layerIndex];
  const selectedIndex = Math.max(0, layer.entities.findIndex((entity) => entity.id === selectedEntityId));
  const outerLayer = ENTITY_LAYERS[(layerIndex + 1) % ENTITY_LAYERS.length];

  useEffect(() => {
    document.getElementById(`arc-card-${selectedEntityId.replaceAll(".", "-")}`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedEntityId]);

  useEffect(() => {
    const handleTab = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      const wrapped = (selectedIndex + (event.shiftKey ? -1 : 1) + layer.entities.length) % layer.entities.length;
      const entity = layer.entities[wrapped];
      onSelect(entity);
      window.requestAnimationFrame(() => document.getElementById(`arc-card-${entity.id.replaceAll(".", "-")}`)?.focus());
    };
    window.addEventListener("keydown", handleTab);
    return () => window.removeEventListener("keydown", handleTab);
  }, [layer, onSelect, selectedIndex]);

  function selectEntity(index: number) {
    const wrapped = (index + layer.entities.length) % layer.entities.length;
    const entity = layer.entities[wrapped];
    onSelect(entity);
  }

  function selectLayer(direction: 1 | -1) {
    const nextIndex = (layerIndex + direction + ENTITY_LAYERS.length) % ENTITY_LAYERS.length;
    onSelect(ENTITY_LAYERS[nextIndex].entities[0]);
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const now = performance.now();
    if (Math.abs(event.deltaY) < 5 || now - wheelAt.current < 180) return;
    wheelAt.current = now;
    selectEntity(selectedIndex + (event.deltaY > 0 ? 1 : -1));
  }

  return (
    <section className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 h-[270px] overflow-hidden" aria-label="Nexus entity navigator" onWheel={handleWheel}>
      <div aria-hidden className="absolute inset-x-[-8%] bottom-[-155px] h-[390px] rounded-[50%_50%_0_0/100%_100%_0_0] border-t border-[#b36c32]/30 bg-[linear-gradient(180deg,rgba(31,24,20,0.82),rgba(4,6,8,0.97)_48%)] shadow-[0_-28px_90px_rgba(0,0,0,0.6),inset_0_2px_0_rgba(255,255,255,0.05),inset_0_18px_50px_rgba(191,93,27,0.06)] backdrop-blur-xl" />

      <div aria-hidden className="pointer-events-none absolute inset-x-24 top-5 flex justify-center gap-4 opacity-20">
        {outerLayer.entities.slice(0, 8).map((entity, index, entities) => (
          <div
            key={entity.id}
            className="flex h-10 w-24 items-center gap-2 rounded-lg border border-white/10 bg-black/50 px-2 transition-transform duration-500"
            style={{ transform: downwardArcTransform(index, (entities.length - 1) / 2, 28, Math.max(1, (entities.length - 1) / 2), 5) }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={entityLogoUrl(entity.type, entity.slug)} alt="" className="h-5 w-5 rounded-full opacity-70" />
            <span className="truncate font-mono text-[0.42rem] tracking-[0.12em] text-silver-300 uppercase">{entity.name}</span>
          </div>
        ))}
      </div>

      <div className="absolute top-11 left-4 z-20 flex flex-col items-center gap-1 sm:left-7">
        <button type="button" onClick={() => selectLayer(-1)} aria-label="Previous station layer" className="founders-surface flex h-8 w-8 items-center justify-center rounded-full text-silver-300 hover:text-white"><ChevronUpIcon size="sm" /></button>
        <span className="max-w-20 truncate font-mono text-[0.46rem] tracking-[0.16em] text-[#c18a5a] uppercase">{layer.name}</span>
        <button type="button" onClick={() => selectLayer(1)} aria-label="Next station layer" className="founders-surface flex h-8 w-8 items-center justify-center rounded-full text-silver-300 hover:text-white"><ChevronDownIcon size="sm" /></button>
      </div>

      <div
        className="absolute inset-x-16 top-14 bottom-3 flex items-start gap-3 overflow-x-auto overflow-y-hidden px-[42vw] pb-2 sm:inset-x-24 sm:gap-4"
        style={{ scrollbarColor: "rgba(194,126,67,0.58) rgba(255,255,255,0.05)", scrollbarWidth: "thin" }}
      >
        {layer.entities.map((entity, index) => {
          const distance = Math.abs(index - selectedIndex);
          const selected = entity.id === selectedEntityId;
          const scale = selected ? 1 : Math.max(0.9, 0.98 - distance * 0.025);
          return (
            <article
              key={entity.id}
              className={`relative mt-2 w-[190px] shrink-0 rounded-2xl border p-3 backdrop-blur-md transition-[transform,opacity,border-color,background-color] duration-500 ${selected ? "border-[#d8904d]/55 bg-[#18130f]/90 opacity-100 shadow-[0_18px_50px_rgba(0,0,0,0.5),0_0_35px_rgba(209,111,37,0.12)]" : "border-white/10 bg-[#080b0d]/78 opacity-72"}`}
              style={{ transform: downwardArcTransform(index, selectedIndex, 44, 4, 7, scale) }}
            >
              <button
                id={`arc-card-${entity.id.replaceAll(".", "-")}`}
                type="button"
                tabIndex={selected ? 0 : -1}
                onFocus={() => onSelect(entity)}
                onClick={() => { if (selected) onEnter(entity); else onSelect(entity); }}
                className="block w-full rounded-xl text-left outline-none focus-visible:ring-1 focus-visible:ring-[#e1a05e]"
                aria-label={selected ? `Enter ${entity.name}` : `Select ${entity.name}`}
              >
                <span className="flex items-center gap-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={entityLogoUrl(entity.type, entity.slug)} alt="" className="h-8 w-8 rounded-full border border-white/12 bg-black/50 p-0.5" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium tracking-[0.14em] text-silver-50 uppercase">{entity.name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[0.46rem] tracking-[0.13em] text-[#ba8150] uppercase">{entity.role ?? entity.label ?? entity.type}</span>
                  </span>
                </span>
                <span className="mt-2 block h-8 overflow-hidden text-[0.64rem] leading-4 text-silver-400">{descriptionFor(entity)}</span>
              </button>
              <div className="mt-2 flex items-center gap-1.5 border-t border-white/8 pt-2">
                <button type="button" onClick={() => playVoice(entityAudioUrl(entity.type, entity.slug))} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 font-mono text-[0.44rem] tracking-[0.1em] text-silver-300 uppercase hover:border-white/25 hover:text-white"><SpeakerIcon animated width={11} height={11} /> Briefing</button>
                {entity.type === "orchestrator" ? <button type="button" onClick={() => playVoice(orchestratorMessageUrl(entity.slug))} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 font-mono text-[0.44rem] tracking-[0.1em] text-silver-300 uppercase hover:border-white/25 hover:text-white"><SpeakerIcon animated width={11} height={11} /> Meet</button> : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
