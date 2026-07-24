"use client";

import Image from "next/image";
import { memo, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  BellIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  SearchIcon,
  ShareIcon,
} from "@vorinthex/shared/ui/icons";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import { appendThreadMessages, streamOrchestratorChat, updateThreadMessage, type OrchestratorChatMessage, type OrchestratorChatThreads } from "@/lib/founders/orchestrator-chat";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { entityLogoThumbnailUrl } from "@/lib/three/entity-logo";

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

const ScopeMark = memo(function ScopeMark({ entity, size = 28 }: { entity: GalaxyEntity; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0 overflow-hidden rounded-full border border-[var(--border-faint)] bg-obsidian-990/80" style={{ width: size, height: size }}>
      <Image src={entityLogoThumbnailUrl(entity.type, entity.slug)} alt="" fill sizes={`${size}px`} loading="lazy" unoptimized className="object-contain p-[2px] opacity-90" />
    </span>
  );
});

const PersonMark = memo(function PersonMark({ slug, name, size = 34 }: { slug: string; name: string; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0 overflow-hidden rounded-full border border-[var(--border-soft)] bg-obsidian-990/85 shadow-[0_0_20px_rgba(174,182,188,0.08)]" style={{ width: size, height: size }}>
      <Image src={entityLogoThumbnailUrl("orchestrator", slug)} alt={`${name} emblem`} fill sizes={`${size}px`} loading="lazy" unoptimized className="object-contain p-[2px]" />
    </span>
  );
});

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

interface OrchestratorRailProps extends HqCommunicationOverlayProps {
  selectedOrchestratorSlug: string;
  onSelectOrchestrator: (orchestrator: GalaxyEntity) => void;
}

const OrchestratorRail = memo(function OrchestratorRail({ selectedScopeId, onScopeChange, selectedOrchestratorSlug, onSelectOrchestrator }: OrchestratorRailProps) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-[var(--border-faint)] bg-obsidian-950/70 backdrop-blur-xl">
      <div className="border-b border-[var(--border-faint)] p-4">
        <span className="mb-2 block font-mono text-[9px] uppercase tracking-[0.2em] text-silver-500">
          Scope
        </span>
        <ScopeSelector selectedScopeId={selectedScopeId} onScopeChange={onScopeChange} />
      </div>

      <div className="scrollbar-hide min-h-0 flex-1 contain-content overscroll-contain overflow-y-auto p-3.5 [scrollbar-gutter:stable]">
        <div className="mb-2 flex items-center justify-between px-1.5">
          <p className="font-mono text-[9px] tracking-[0.2em] text-silver-500">Orchestrators</p>
        </div>
        <div className="space-y-0.5">
          {orderedOrchestrators.map((orchestrator) => (
            <button key={orchestrator.id} type="button" aria-current={orchestrator.slug === selectedOrchestratorSlug ? "page" : undefined} onClick={() => onSelectOrchestrator(orchestrator)} className={`flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12px] transition-colors [contain:layout_paint] ${orchestrator.slug === selectedOrchestratorSlug ? "bg-[var(--panel-strong)] text-silver-50" : "text-silver-300 hover:bg-white/[0.04] hover:text-silver-100"}`}>
              <PersonMark slug={orchestrator.slug} name={orchestrator.name} size={24} />
              <span className="truncate">{orchestrator.name}</span>
            </button>
          ))}
        </div>
      </div>

    </aside>
  );
});

function Message({ message, orchestrator }: { message: OrchestratorChatMessage; orchestrator: GalaxyEntity }) {
  return (
    <article className="group flex gap-3 px-1 py-3">
      {message.role === "assistant" ? <PersonMark slug={orchestrator.slug} name={orchestrator.name} size={38} /> : (
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-[var(--border-soft)] bg-obsidian-850 font-mono text-[8px] text-silver-200">YOU</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13px] font-medium text-silver-50">{message.role === "assistant" ? orchestrator.name : "You"}</h3>
        </div>
        <p className={`mt-1 whitespace-pre-wrap text-[12px] leading-5 ${message.failed ? "text-status-critical" : "text-silver-300"}`}>
          {message.text || <span className="animate-pulse text-silver-500">Thinking...</span>}
        </p>
      </div>
    </article>
  );
}

interface ConversationPaneProps {
  orchestrator: GalaxyEntity;
  messages: OrchestratorChatMessage[];
  draft: string;
  streaming: boolean;
  error: string | null;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function ConversationPane({ orchestrator, messages, draft, streaming, error, onDraftChange, onSubmit }: ConversationPaneProps) {
  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return (
    <section className="relative flex min-h-0 min-w-0 flex-col bg-obsidian-990/55 backdrop-blur-[3px]">
      <div className="flex min-h-[78px] items-center justify-between gap-4 border-b border-[var(--border-faint)] px-5 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <PersonMark slug={orchestrator.slug} name={orchestrator.name} size={34} />
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg tracking-[0.04em] text-silver-50">{orchestrator.name}</h1>
            <p className="mt-0.5 hidden truncate text-[10px] text-silver-500 sm:block">{orchestrator.fullTitle ?? orchestrator.role ?? "Vorinthex orchestrator"}</p>
          </div>
        </div>
      </div>

      <div className="flex h-11 items-center border-b border-[var(--border-faint)] px-5 text-[11px] text-silver-400 sm:px-6">
        Messages
      </div>

      <div ref={messagesRef} className="scrollbar-hide min-h-0 flex-1 overflow-y-auto px-4 py-2 sm:px-6" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <PersonMark slug={orchestrator.slug} name={orchestrator.name} size={48} />
              <p className="mt-3 text-sm text-silver-200">Start a conversation with {orchestrator.name}.</p>
              <p className="mt-1 text-[11px] text-silver-500">Ask anything, including a simple hello.</p>
            </div>
          </div>
        ) : messages.map((message) => <Message key={message.id} message={message} orchestrator={orchestrator} />)}
      </div>

      <div className="p-3 sm:p-4">
        <form onSubmit={onSubmit} className="rounded-xl border border-[var(--border-soft)] bg-obsidian-900/70 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl focus-within:border-[var(--border-strong)]">
          <textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} rows={2} maxLength={8_000} placeholder={`Message ${orchestrator.name}`} aria-label={`Message ${orchestrator.name}`} className="block w-full resize-none bg-transparent text-[12px] leading-5 text-silver-100 outline-none placeholder:text-silver-500" />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className={`text-[10px] ${error ? "text-status-critical" : "text-silver-600"}`}>{error ?? (streaming ? `${orchestrator.name} is responding...` : "Enter to send · Shift+Enter for a new line")}</span>
            <button type="submit" disabled={streaming || !draft.trim()} aria-label={`Send message to ${orchestrator.name}`} className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--gradient-chrome)] text-obsidian-990 transition-opacity disabled:cursor-not-allowed disabled:opacity-35">
              <ShareIcon aria-hidden size="sm" />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

export default function HqCommunicationOverlay(props: HqCommunicationOverlayProps) {
  const [selectedOrchestratorSlug, setSelectedOrchestratorSlug] = useState("atlas");
  const [threads, setThreads] = useState<OrchestratorChatThreads>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [streaming, setStreaming] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const controllers = useRef(new Map<string, AbortController>());
  const selectedOrchestrator = orchestratorById.get(`orchestrator.${selectedOrchestratorSlug}`) ?? orderedOrchestrators[0]!;

  useEffect(() => () => {
    for (const controller of controllers.current.values()) controller.abort();
  }, []);

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const slug = selectedOrchestrator.slug;
    const text = (drafts[slug] ?? "").trim();
    if (!text || streaming[slug]) return;
    const requestId = crypto.randomUUID();
    const responseId = crypto.randomUUID();
    setThreads((current) => appendThreadMessages(current, slug,
      { id: requestId, role: "user", text },
      { id: responseId, role: "assistant", text: "" },
    ));
    setDrafts((current) => ({ ...current, [slug]: "" }));
    setErrors((current) => ({ ...current, [slug]: null }));
    setStreaming((current) => ({ ...current, [slug]: true }));
    const controller = new AbortController();
    controllers.current.set(slug, controller);
    try {
      await streamOrchestratorChat(slug, text, (streamEvent) => {
        if (streamEvent.type !== "token") return;
        setThreads((current) => updateThreadMessage(current, slug, responseId, (message) => ({ ...message, text: message.text + streamEvent.text })));
      }, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Chat failed";
      setErrors((current) => ({ ...current, [slug]: message }));
      setThreads((current) => updateThreadMessage(current, slug, responseId, (entry) => ({ ...entry, failed: true, text: entry.text || message })));
    } finally {
      controllers.current.delete(slug);
      setStreaming((current) => ({ ...current, [slug]: false }));
    }
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-10 flex min-h-0 flex-col p-1.5 sm:p-2.5">
      <div className="flex h-12 shrink-0 items-center border border-[var(--border-faint)] bg-obsidian-990/65 px-3 shadow-[0_10px_50px_rgba(0,0,0,0.28)] backdrop-blur-lg sm:h-14 sm:px-4">
        <div className="flex w-auto items-center gap-2 sm:w-[244px]">
          <Image src="/logos/vorinthex-mark.png" alt="Vorinthex" width={23} height={23} className="opacity-90" />
          <span className="hidden font-display text-[11px] tracking-[0.16em] text-silver-300 sm:block">VORINTHEX</span>
        </div>
        <div className="ml-3 flex min-w-0 flex-1 items-center gap-2 font-mono text-[9px] uppercase tracking-[0.13em] text-silver-500 sm:ml-0">
          <span className="text-silver-300">HQ</span><span>/</span><span className="hidden sm:inline">Vorinthex HQ</span><span className="hidden sm:inline">/</span><span className="truncate text-silver-500">{selectedOrchestrator.name}</span>
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          <div className="flex h-8 w-44 items-center gap-2 rounded-lg border border-[var(--border-faint)] bg-obsidian-990/20 px-3 text-silver-500"><SearchIcon aria-hidden size="sm" /><span className="text-[10px]">Search HQ</span></div>
          <IconFrame><BellIcon aria-hidden size="sm" /></IconFrame>
          <div className="flex h-8 items-center gap-2 rounded-lg border border-[var(--border-faint)] bg-obsidian-990/20 px-2.5"><span className="h-5 w-5 rounded-full border border-[var(--border-soft)] bg-obsidian-850" /><span className="text-[10px] text-silver-300">Oscar</span></div>
        </div>
      </div>

      <div className="hq-workspace-grid grid min-h-0 flex-1 grid-rows-[minmax(190px,34vh)_minmax(0,1fr)] overflow-hidden border-x border-b border-[var(--border-faint)] md:grid-cols-[248px_minmax(0,1fr)] md:grid-rows-1">
        <OrchestratorRail {...props} selectedOrchestratorSlug={selectedOrchestratorSlug} onSelectOrchestrator={(orchestrator) => {
          setSelectedOrchestratorSlug(orchestrator.slug);
          props.onScopeChange(orchestrator.id);
        }} />
        <ConversationPane
          orchestrator={selectedOrchestrator}
          messages={threads[selectedOrchestrator.slug] ?? []}
          draft={drafts[selectedOrchestrator.slug] ?? ""}
          streaming={Boolean(streaming[selectedOrchestrator.slug])}
          error={errors[selectedOrchestrator.slug] ?? null}
          onDraftChange={(value) => setDrafts((current) => ({ ...current, [selectedOrchestrator.slug]: value }))}
          onSubmit={submitMessage}
        />
      </div>
    </div>
  );
}
