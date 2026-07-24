"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  BellIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  FileIcon,
  ImageIcon,
  LinkIcon,
  PlusIcon,
  SearchIcon,
  ShareIcon,
} from "@vorinthex/shared/ui/icons";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { entityLogoUrl } from "@/lib/three/entity-logo";

interface HqCommunicationOverlayProps {
  selectedScopeId: string;
  onScopeChange: (id: string) => void;
}

const scopeEntities = [
  VORINTHEX_GALAXY_REGISTRY.nexus,
  ...Object.values(VORINTHEX_GALAXY_REGISTRY.products),
  ...Object.values(VORINTHEX_GALAXY_REGISTRY.capabilities),
  ...Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators),
];

const orchestrators = Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators);
const orchestratorById = new Map(orchestrators.map((entity) => [entity.id, entity]));

function orchestratorDepth(entity: GalaxyEntity) {
  let depth = 0;
  let current = entity;
  while (current.reportsTo) {
    const parent = orchestratorById.get(current.reportsTo);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

const orderedOrchestrators = [
  orchestrators.find((entity) => entity.slug === "atlas"),
  ...[1, 2, 3].flatMap((depth) => orchestrators.filter((entity) => entity.slug !== "atlas" && orchestratorDepth(entity) === depth)),
].filter((entity): entity is GalaxyEntity => Boolean(entity));

function ScopeMark({ entity, size = 28 }: { entity: GalaxyEntity; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0 overflow-hidden rounded-full border border-[var(--border-faint)] bg-obsidian-990/80" style={{ width: size, height: size }}>
      <Image src={entityLogoUrl(entity.type, entity.slug)} alt="" fill sizes={`${size}px`} className="object-contain p-[2px] opacity-90" />
    </span>
  );
}

function PersonMark({ slug, name, size = 34 }: { slug: string; name: string; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0 overflow-hidden rounded-full border border-[var(--border-soft)] bg-obsidian-990/85 shadow-[0_0_20px_rgba(174,182,188,0.08)]" style={{ width: size, height: size }}>
      <Image src={entityLogoUrl("orchestrator", slug)} alt={`${name} emblem`} fill sizes={`${size}px`} className="object-contain p-[2px]" />
    </span>
  );
}

function IconFrame({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <span aria-label={label} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-faint)] bg-[var(--panel)] text-silver-500">
      {children}
    </span>
  );
}

function ScopeSelector({ selectedScopeId, onScopeChange }: HqCommunicationOverlayProps) {
  const selectedIndex = Math.max(0, scopeEntities.findIndex((scope) => scope.id === selectedScopeId));
  const selectedScope = scopeEntities[selectedIndex] ?? scopeEntities[0]!;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filteredScopes = scopeEntities.filter((scope) => scope.name.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!pickerOpen) return;
    const dismissPicker = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", dismissPicker);
    return () => document.removeEventListener("pointerdown", dismissPicker);
  }, [pickerOpen]);

  const closePicker = (restoreFocus = false) => {
    setPickerOpen(false);
    setQuery("");
    if (restoreFocus) triggerRef.current?.focus();
  };

  const selectFilteredScope = (index: number) => {
    const scope = filteredScopes[index];
    if (!scope) return;
    onScopeChange(scope.id);
    closePicker();
  };

  const handlePickerKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker(true);
      return;
    }
    if (filteredScopes.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + direction + filteredScopes.length) % filteredScopes.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectFilteredScope(activeIndex);
    }
  };

  return (
    <div ref={pickerRef} className="flex min-w-0 items-center">
      <div className="relative min-w-0 flex-1">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            if (pickerOpen) closePicker();
            else {
              setQuery("");
              setActiveIndex(selectedIndex);
              setPickerOpen(true);
            }
          }}
          aria-expanded={pickerOpen}
          aria-haspopup="listbox"
          className="flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-[var(--border-faint)] bg-[var(--panel)] px-2.5 text-left transition-colors hover:border-[var(--border-strong)]"
        >
          <span className="flex min-w-0 items-center gap-2">
            <ScopeMark entity={selectedScope} size={28} />
            <span className="min-w-0 truncate text-[13px] text-silver-100">{selectedScope.name}</span>
          </span>
          {pickerOpen ? <ChevronUpIcon aria-hidden size="sm" className="shrink-0 text-silver-500" /> : <ChevronDownIcon aria-hidden size="sm" className="shrink-0 text-silver-500" />}
        </button>
        {pickerOpen ? (
          <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-20 rounded-2xl border border-[var(--border-strong)] bg-obsidian-990/95 p-2 shadow-2xl backdrop-blur-2xl">
            <div className="relative mb-2">
              <input
                ref={inputRef}
                autoFocus
                role="combobox"
                aria-expanded="true"
                aria-controls="hq-scope-options"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
                onKeyDown={handlePickerKeyDown}
                placeholder="Search scopes..."
                className="w-full rounded-xl border border-[var(--border-faint)] bg-white/[0.04] py-2 pr-9 pl-3 font-mono text-[10px] text-silver-100 outline-none placeholder:text-silver-600 focus:border-[var(--border-strong)]"
              />
              {query ? (
                <button type="button" aria-label="Clear scope search" onClick={() => { setQuery(""); setActiveIndex(0); inputRef.current?.focus(); }} className="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-silver-500 hover:bg-white/[0.07] hover:text-white">
                  <CloseIcon size="sm" />
                </button>
              ) : null}
            </div>
            <div id="hq-scope-options" role="listbox" className="scrollbar-hide max-h-64 overflow-y-auto">
              {filteredScopes.length > 0 ? filteredScopes.map((scope, index) => (
                <button key={scope.id} type="button" role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => selectFilteredScope(index)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] transition-colors ${index === activeIndex ? "bg-white/[0.07] text-white" : "text-silver-400 hover:bg-white/[0.07] hover:text-white"}`}>
                  <ScopeMark entity={scope} size={22} />
                  <span className="truncate">{scope.name}</span>
                </button>
              )) : <p className="px-2.5 py-3 text-[11px] text-silver-500">No scopes found.</p>}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OrchestratorRail({ selectedScopeId, onScopeChange }: HqCommunicationOverlayProps) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-[var(--border-faint)] bg-obsidian-950/70 backdrop-blur-xl">
      <div className="border-b border-[var(--border-faint)] p-4">
        <span className="mb-2 block font-mono text-[9px] uppercase tracking-[0.2em] text-silver-500">
          Scope
        </span>
        <ScopeSelector selectedScopeId={selectedScopeId} onScopeChange={onScopeChange} />
      </div>

      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto p-3.5">
        <div className="mb-2 flex items-center justify-between px-1.5">
          <p className="font-mono text-[9px] tracking-[0.2em] text-silver-500">Orchestrators</p>
        </div>
        <div className="space-y-0.5">
          {orderedOrchestrators.map((orchestrator) => (
            <div key={orchestrator.id} className="flex h-9 items-center gap-2 px-2.5 text-[12px] text-silver-300">
              <PersonMark slug={orchestrator.slug} name={orchestrator.name} size={24} />
              <span className="truncate">{orchestrator.name}</span>
            </div>
          ))}
        </div>
      </div>

    </aside>
  );
}

function AttachmentCard() {
  return (
    <div className="mt-2.5 flex w-fit items-center gap-3 rounded-xl border border-[var(--border-faint)] bg-obsidian-990/25 p-2.5 pr-5">
      <IconFrame><FileIcon aria-hidden size="md" /></IconFrame>
      <div>
        <p className="text-[12px] text-silver-100">Orchestration Refactor Spec.docx</p>
        <p className="mt-0.5 font-mono text-[9px] text-silver-500">Archive · Document · 2.4 MB</p>
      </div>
    </div>
  );
}

function Message({ name, slug, time, children }: { name: string; slug: string; time: string; children: React.ReactNode }) {
  return (
    <article className="group flex gap-3 px-1 py-3">
      <PersonMark slug={slug} name={name} size={38} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13px] font-medium text-silver-50">{name}</h3>
          <time className="font-mono text-[9px] text-silver-500">{time}</time>
        </div>
        <div className="mt-1 text-[12px] leading-5 text-silver-300">{children}</div>
      </div>
    </article>
  );
}

function ConversationPane() {
  return (
    <section className="relative flex min-h-0 min-w-0 flex-col bg-obsidian-990/55 backdrop-blur-[3px]">
      <div className="flex min-h-[78px] items-center justify-between gap-4 border-b border-[var(--border-faint)] px-5 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-display text-3xl text-silver-100">#</span>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg tracking-[0.04em] text-silver-50">engineering</h1>
            <p className="mt-0.5 hidden truncate text-[10px] text-silver-500 sm:block">Engineering coordination and technical discussions.</p>
          </div>
        </div>
        <div className="flex items-center">
          {orderedOrchestrators.slice(0, 4).map((orchestrator, index) => (
            <span key={orchestrator.id} className={index > 0 ? "-ml-2" : ""}><PersonMark slug={orchestrator.slug} name={orchestrator.name} size={29} /></span>
          ))}
          <span className="ml-2 font-mono text-[9px] text-silver-500">+18</span>
        </div>
      </div>

      <div className="flex h-11 items-end gap-6 border-b border-[var(--border-faint)] px-5 sm:px-6">
        {[
          ["Messages", true],
          ["Threads", false],
          ["Pins", false],
          ["Files", false],
        ].map(([label, active]) => (
          <span key={String(label)} className={`flex h-full items-center border-b text-[11px] ${active ? "border-silver-300 text-silver-100" : "border-transparent text-silver-500"}`}>{label}</span>
        ))}
      </div>

      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto px-4 py-2 sm:px-6">
        <div className="my-1 flex items-center gap-3">
          <span className="h-px flex-1 bg-[var(--border-faint)]" />
          <span className="rounded-full border border-[var(--border-faint)] bg-obsidian-990/25 px-3 py-1 font-mono text-[8px] uppercase tracking-[0.16em] text-silver-500">Today</span>
          <span className="h-px flex-1 bg-[var(--border-faint)]" />
        </div>
        <Message name="Atlas" slug="atlas" time="09:42">
          <p>We should refactor the orchestration layer to support multi-agent streaming. What are your thoughts?</p>
          <div className="mt-2 flex gap-1.5">
            <span className="rounded-lg border border-[var(--border-faint)] bg-obsidian-990/20 px-2 py-1 font-mono text-[9px] text-silver-300">△ 3</span>
            <span className="rounded-lg border border-[var(--border-faint)] bg-obsidian-990/20 px-2 py-1 font-mono text-[9px] text-silver-300">✦ 2</span>
          </div>
        </Message>
        <Message name="Forge" slug="forge" time="09:44">
          <p>Agreed. I&apos;ve created a draft spec in Archive.</p>
          <AttachmentCard />
        </Message>
      </div>

      <div className="p-3 sm:p-4">
        <div className="rounded-xl border border-[var(--border-soft)] bg-obsidian-900/70 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <p className="text-[11px] text-silver-500">Message #engineering</p>
          <div className="mt-3 flex items-center justify-between gap-3 text-silver-500">
            <div className="flex items-center gap-3">
              <PlusIcon aria-hidden size="sm" />
              <LinkIcon aria-hidden size="sm" />
              <ImageIcon aria-hidden size="sm" />
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm">@</span>
              <ShareIcon aria-hidden size="sm" />
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--gradient-chrome)] text-obsidian-990">›</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function HqCommunicationOverlay(props: HqCommunicationOverlayProps) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-10 flex min-h-0 flex-col p-1.5 sm:p-2.5">
      <div className="flex h-12 shrink-0 items-center border border-[var(--border-faint)] bg-obsidian-990/65 px-3 shadow-[0_10px_50px_rgba(0,0,0,0.28)] backdrop-blur-lg sm:h-14 sm:px-4">
        <div className="flex w-auto items-center gap-2 sm:w-[244px]">
          <Image src="/logos/vorinthex-mark.png" alt="Vorinthex" width={23} height={23} className="opacity-90" />
          <span className="hidden font-display text-[11px] tracking-[0.16em] text-silver-300 sm:block">VORINTHEX</span>
        </div>
        <div className="ml-3 flex min-w-0 flex-1 items-center gap-2 font-mono text-[9px] uppercase tracking-[0.13em] text-silver-500 sm:ml-0">
          <span className="text-silver-300">HQ</span><span>/</span><span className="hidden sm:inline">Vorinthex HQ</span><span className="hidden sm:inline">/</span><span className="truncate text-silver-500">#engineering</span>
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          <div className="flex h-8 w-44 items-center gap-2 rounded-lg border border-[var(--border-faint)] bg-obsidian-990/20 px-3 text-silver-500"><SearchIcon aria-hidden size="sm" /><span className="text-[10px]">Search HQ</span></div>
          <IconFrame><BellIcon aria-hidden size="sm" /></IconFrame>
          <div className="flex h-8 items-center gap-2 rounded-lg border border-[var(--border-faint)] bg-obsidian-990/20 px-2.5"><span className="h-5 w-5 rounded-full border border-[var(--border-soft)] bg-obsidian-850" /><span className="text-[10px] text-silver-300">Oscar</span></div>
        </div>
      </div>

      <div className="hq-workspace-grid grid min-h-0 flex-1 grid-rows-[minmax(190px,34vh)_minmax(0,1fr)] overflow-hidden border-x border-b border-[var(--border-faint)] md:grid-cols-[248px_minmax(0,1fr)] md:grid-rows-1">
        <OrchestratorRail {...props} />
        <ConversationPane />
      </div>
    </div>
  );
}
