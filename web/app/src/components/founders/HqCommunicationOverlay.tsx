"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import * as Dialog from "@radix-ui/react-dialog";
import type { EmojiStyle, Theme } from "emoji-picker-react";
import { memo, useCallback, useEffect, useRef, useState, type ComponentProps, type FormEvent, type KeyboardEvent } from "react";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, MicrophoneIcon, SendIcon } from "@vorinthex/shared/ui/icons";
import { Button, SearchInput, Spinner, Textarea } from "@vorinthex/shared/ui";
import { useAudioStore } from "@/lib/audio/audio-store";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { entityLogoThumbnailUrl } from "@/lib/three/entity-logo";
import {
  closeChorusPoll,
  activeChorusMentionQuery,
  buildChorusMentionRows,
  CHORUS_ORCHESTRATOR_NAMES,
  closestChorusMentionCompletion,
  clearChorusChannel,
  directChorusReplies,
  coalesceChorusStreamEvents,
  createChorusPoll,
  deleteChorusMessage,
  filterChorusMentionShortcuts,
  formatChorusTypingLabel,
  listChorusChannels,
  listChorusFrequentReactions,
  listChorusMessages,
  markChorusStreamFailed,
  mergeChorusMessageRefresh,
  mutateChorusReaction,
  publishChorusTyping,
  readChorusReplies,
  plainChorusText,
  reconcileChorusStreamEvent,
  setChorusReactionState,
  streamChorusMessage,
  subscribeChorusTyping,
  synthesizeChorusSpeech,
  transcribeChorusAudio,
  voteChorusPoll,
  type ChorusChannelEntry,
  type ChorusDisplayMessage,
  type ChorusMessage,
  type ChorusMention,
  type ChorusMentionRoster,
  type ChorusTypingEvent,
  type ChorusStreamEvent,
} from "@/lib/founders/chorus";
import { createFrameBatcher } from "@/lib/founders/frame-batcher";
import { appendSpokenTranscript, startPcmCapture, type PcmCapture } from "@/lib/founders/chorus-microphone";
import { subscribeNexusInvalidations } from "@/lib/founders/nexus-events";

const loadEmojiPicker = () => import("emoji-picker-react");
const DynamicEmojiPicker = dynamic(loadEmojiPicker, { ssr: false });

function EmojiPicker(props: ComponentProps<typeof DynamicEmojiPicker>) {
  return <DynamicEmojiPicker {...props} lazyLoadEmojis={false} style={{ ...props.style, backgroundColor: "transparent", borderColor: "transparent" }} />;
}

interface HqCommunicationOverlayProps {
  organizationKey: string;
  organizationOptions: Array<{ key: string; name: string; hint?: string | null }>;
  onOrganizationChange: (key: string) => void;
  userName: string;
  countryCode: string;
  selectedScopeId: string;
  onScopeChange: (id: string) => void;
}

const registryOrchestrators = Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators);
const scopeEntities = [
  VORINTHEX_GALAXY_REGISTRY.nexus,
  ...Object.values(VORINTHEX_GALAXY_REGISTRY.products),
  ...Object.values(VORINTHEX_GALAXY_REGISTRY.capabilities),
  ...registryOrchestrators,
];
const normalizeName = (name: string) => name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
const registryByName = new Map(registryOrchestrators.map((entity) => [normalizeName(entity.name), entity]));
const MESSAGE_ACTIONS_ENABLED = true;

function OrchestratorMark({ name, size = 36 }: { name: string; size?: number }) {
  const entity = registryByName.get(normalizeName(name));
  return entity ? <span className="relative inline-flex shrink-0 overflow-hidden rounded-full border border-[var(--border-soft)] bg-obsidian-990/85" style={{ width: size, height: size }}><Image src={entityLogoThumbnailUrl("orchestrator", entity.slug)} alt={`${name} emblem`} fill sizes={`${size}px`} unoptimized className="object-contain p-[2px]" /></span> : <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full border border-[var(--border-soft)] bg-obsidian-900 font-mono text-[9px] text-silver-300" style={{ width: size, height: size }}>{name.slice(0, 2).toUpperCase()}</span>;
}

const COUNTRY_TIME_ZONES: Record<string, string> = {
  AU: "Australia/Sydney", BR: "America/Sao_Paulo", CA: "America/Toronto", CN: "Asia/Shanghai", DE: "Europe/Berlin",
  DK: "Europe/Copenhagen", ES: "Europe/Madrid", FI: "Europe/Helsinki", FR: "Europe/Paris", GB: "Europe/London",
  IN: "Asia/Kolkata", IT: "Europe/Rome", JP: "Asia/Tokyo", KR: "Asia/Seoul", NL: "Europe/Amsterdam", NO: "Europe/Oslo",
  NZ: "Pacific/Auckland", PL: "Europe/Warsaw", PT: "Europe/Lisbon", SE: "Europe/Stockholm", SG: "Asia/Singapore",
  US: "America/New_York",
};

function Timestamp({ value, countryCode }: { value: string; countryCode: string }) {
  const timeZone = COUNTRY_TIME_ZONES[countryCode] ?? "UTC";
  const label = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value));
  return <time dateTime={value} title={value} className="font-mono text-[9px] text-silver-600">{label}</time>;
}

function ScopeMark({ entity, size = 28 }: { entity: GalaxyEntity; size?: number }) {
  return <span className="relative inline-flex shrink-0 overflow-hidden rounded-full border border-[var(--border-faint)] bg-obsidian-990/80" style={{ width: size, height: size }}><Image src={entityLogoThumbnailUrl(entity.type, entity.slug)} alt="" fill sizes={`${size}px`} unoptimized className="object-contain p-[2px] opacity-90" /></span>;
}

function OrganizationMark({ name, hint, size = 28 }: { name: string; hint?: string | null; size?: number }) {
  const identity = `${name} ${hint ?? ""}`.toLowerCase();
  const src = identity.includes("render") ? "/logos/organizations/render.svg" : identity.includes("vorinthex") ? "/logos/vorinthex-mark.png" : null;
  return src ? <span className="relative inline-flex shrink-0 overflow-hidden rounded-full border border-[var(--border-faint)] bg-obsidian-990/80" style={{ width: size, height: size }}><Image src={src} alt="" fill sizes={`${size}px`} unoptimized className="object-contain p-1 opacity-90" /></span> : <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full border border-[var(--border-faint)] bg-obsidian-900 font-mono text-[9px] text-silver-300" style={{ width: size, height: size }}>{name.slice(0, 2).toUpperCase()}</span>;
}

function ScopeSelector({ selectedScopeId, onScopeChange }: Pick<HqCommunicationOverlayProps, "selectedScopeId" | "onScopeChange">) {
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
      if (!pickerRef.current?.contains(event.target as Node)) { setPickerOpen(false); setQuery(""); }
    };
    document.addEventListener("pointerdown", dismissPicker);
    return () => document.removeEventListener("pointerdown", dismissPicker);
  }, [pickerOpen]);

  const closePicker = (restoreFocus = false) => {
    setPickerOpen(false); setQuery("");
    if (restoreFocus) triggerRef.current?.focus();
  };
  const selectFilteredScope = (index: number) => {
    const scope = filteredScopes[index];
    if (!scope) return;
    onScopeChange(scope.id); closePicker();
  };
  const handlePickerKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { event.preventDefault(); closePicker(true); return; }
    if (!filteredScopes.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + direction + filteredScopes.length) % filteredScopes.length);
    } else if (event.key === "Enter") { event.preventDefault(); selectFilteredScope(activeIndex); }
  };

  return <div ref={pickerRef} className="relative min-w-0">
    <Button ref={triggerRef} onClick={() => { if (pickerOpen) closePicker(); else { setQuery(""); setActiveIndex(selectedIndex); setPickerOpen(true); } }} aria-expanded={pickerOpen} aria-haspopup="listbox" aria-controls={pickerOpen ? "hq-scope-options" : undefined} size="md" variant="outline" className="h-11 w-full min-w-0 justify-between gap-2 border-[var(--border-faint)] bg-[var(--panel)] px-2.5 text-left normal-case tracking-normal hover:border-[var(--border-strong)]">
      <span className="flex min-w-0 items-center gap-2"><ScopeMark entity={selectedScope} /><span className="truncate text-[13px] text-silver-100">{selectedScope.name}</span></span>
      {pickerOpen ? <ChevronUpIcon aria-hidden size="sm" className="shrink-0 text-silver-500" /> : <ChevronDownIcon aria-hidden size="sm" className="shrink-0 text-silver-500" />}
    </Button>
    {pickerOpen ? <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-30 rounded-2xl border border-[var(--border-strong)] bg-obsidian-990/95 p-2 shadow-2xl backdrop-blur-2xl">
      <div className="relative mb-2"><input ref={inputRef} autoFocus role="combobox" aria-expanded="true" aria-controls="hq-scope-options" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={handlePickerKeyDown} placeholder="Search scopes..." className="w-full rounded-xl border border-[var(--border-faint)] bg-white/[0.04] py-2 pr-9 pl-3 font-mono text-[10px] text-silver-100 outline-none placeholder:text-silver-600 focus:border-[var(--border-strong)]" />
        {query ? <Button type="button" variant="icon" aria-label="Clear scope search" onClick={() => { setQuery(""); setActiveIndex(0); inputRef.current?.focus(); }} icon={<CloseIcon size="sm" />} className="absolute top-1/2 right-2 h-6 min-h-0 w-6 -translate-y-1/2 text-silver-500">Clear scope search</Button> : null}
      </div>
      <div id="hq-scope-options" role="listbox" className="scrollbar-hide max-h-64 overflow-y-auto overscroll-contain [touch-action:pan-y]">
         {filteredScopes.length ? filteredScopes.map((scope, index) => <Button key={scope.id} role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => selectFilteredScope(index)} size="sm" variant="ghost" className={`w-full justify-start gap-2 px-2.5 py-2 text-left text-[11px] normal-case tracking-normal ${index === activeIndex ? "bg-white/[0.07] text-white" : "text-silver-400 hover:bg-white/[0.07] hover:text-white"}`}><ScopeMark entity={scope} size={22} /><span className="truncate">{scope.name}</span></Button>) : <p className="px-2.5 py-3 text-[11px] text-silver-500">No scopes found.</p>}
      </div>
    </div> : null}
  </div>;
}

function OrganizationSelector({ organizationKey, organizationOptions, onOrganizationChange }: Pick<HqCommunicationOverlayProps, "organizationKey" | "organizationOptions" | "onOrganizationChange">) {
  const selectedOrganization = organizationOptions.find((organization) => organization.key === organizationKey) ?? organizationOptions[0];
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const dismissPicker = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("pointerdown", dismissPicker);
    return () => document.removeEventListener("pointerdown", dismissPicker);
  }, [pickerOpen]);

  return <div ref={pickerRef} className="relative min-w-0">
    <Button ref={triggerRef} onClick={() => setPickerOpen((open) => !open)} aria-expanded={pickerOpen} aria-haspopup="listbox" aria-controls={pickerOpen ? "hq-organization-options" : undefined} size="md" variant="outline" className="h-11 w-full min-w-0 justify-between gap-2 border-[var(--border-faint)] bg-[var(--panel)] px-2.5 text-left normal-case tracking-normal hover:border-[var(--border-strong)]">
      <span className="flex min-w-0 items-center gap-2">{selectedOrganization ? <OrganizationMark name={selectedOrganization.name} hint={selectedOrganization.hint} /> : null}<span className="truncate text-[13px] text-silver-100">{selectedOrganization?.name ?? "Select organization"}</span></span>
      {pickerOpen ? <ChevronUpIcon aria-hidden size="sm" className="shrink-0 text-silver-500" /> : <ChevronDownIcon aria-hidden size="sm" className="shrink-0 text-silver-500" />}
    </Button>
    {pickerOpen ? <div id="hq-organization-options" role="listbox" className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-30 max-h-64 overflow-y-auto rounded-2xl border border-[var(--border-strong)] bg-obsidian-990/95 p-2 shadow-2xl backdrop-blur-2xl">
      {organizationOptions.map((organization) => <Button key={organization.key} role="option" aria-selected={organization.key === organizationKey} onClick={() => { onOrganizationChange(organization.key); setPickerOpen(false); }} size="sm" variant="ghost" className={`w-full justify-start gap-2 px-2.5 py-2 text-left text-[11px] normal-case tracking-normal ${organization.key === organizationKey ? "bg-white/[0.07] text-white" : "text-silver-400 hover:bg-white/[0.07] hover:text-white"}`}><OrganizationMark name={organization.name} hint={organization.hint} size={22} /><span className="min-w-0 truncate">{organization.name}</span></Button>)}
    </div> : null}
  </div>;
}

interface RailProps {
  channels: ChorusChannelEntry[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (entry: ChorusChannelEntry) => void;
  organizationKey: string;
  organizationOptions: HqCommunicationOverlayProps["organizationOptions"];
  onOrganizationChange: (key: string) => void;
  selectedScopeId: string;
  onScopeChange: (id: string) => void;
}

const OrchestratorRail = memo(function OrchestratorRail({ channels, loading, error, onRetry, onSelect, organizationKey, organizationOptions, onOrganizationChange, selectedScopeId, onScopeChange }: RailProps) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-[var(--border-faint)] bg-obsidian-950/90 [contain:layout_paint]">
      <div className="border-b border-[var(--border-faint)] p-4"><span className="mb-2 block font-mono text-[9px] uppercase tracking-[0.2em] text-silver-500">Organization</span><OrganizationSelector organizationKey={organizationKey} organizationOptions={organizationOptions} onOrganizationChange={onOrganizationChange} /><span className="mt-4 mb-2 block font-mono text-[9px] uppercase tracking-[0.2em] text-silver-500">Scope</span><ScopeSelector selectedScopeId={selectedScopeId} onScopeChange={onScopeChange} /></div>
      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [contain:content]">
        <span className="mb-2 block font-mono text-[9px] tracking-[0.2em] text-silver-500">Channels</span>
        {loading ? <div aria-label="Loading channels" className="space-y-2">{[0, 1, 2, 3].map((item) => <div key={item} className="h-10 animate-pulse rounded-lg bg-white/[0.04]" />)}</div> : null}
        {error ? <div role="alert" className="rounded-xl border border-status-critical/30 p-3 text-[11px] text-status-critical"><p>{error}</p><Button type="button" variant="secondary" onClick={onRetry} className="mt-2 min-h-0 rounded-md px-3 py-1.5 text-[9px]">Retry</Button></div> : null}
        {!loading && !error && channels.length === 0 ? <p className="p-2 text-[11px] text-silver-500">No channels are available.</p> : null}
        <div className="space-y-1">
          {channels.map((entry) => {
            return (
              <Button key={entry.orchestrator.key} aria-label={`${entry.orchestrator.name}${entry.canChat ? "" : ", chat unavailable"}`} onClick={() => onSelect(entry)} size="sm" variant="secondary" className={`w-full justify-start gap-2 px-2.5 py-2 text-left tracking-normal no-underline hover:no-underline focus-visible:outline-2 focus-visible:outline-silver-300 ${entry.canChat ? "" : "opacity-55"}`}>
                 <span aria-hidden className="font-mono text-[12px] text-silver-500">#</span><span className="min-w-0 flex-1 truncate pb-px text-[12px] leading-5 lowercase no-underline">{entry.channel?.name ?? entry.orchestrator.name}</span>
                {!entry.canChat ? <span aria-hidden title="Chat unavailable" className="text-[10px]">LOCK</span> : null}
              </Button>
            );
          })}
        </div>
      </div>
    </aside>
  );
});

interface PollViewProps {
  organizationKey: string;
  channelKey: string;
  message: ChorusMessage;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
  onError: (error: string | null) => void;
}

function PollView({ organizationKey, channelKey, message, busy, onBusy, onRefresh, onError }: PollViewProps) {
  const poll = message.poll;
  if (!poll) return null;
  const mutate = async (action: () => Promise<unknown>) => {
    if (busy) return;
    onBusy(true); onError(null);
    let mutationError: string | null = null;
    try { await action(); } catch (error) { mutationError = error instanceof Error ? error.message : "Poll update failed"; }
    try { await onRefresh(); } catch (error) { if (!mutationError) mutationError = error instanceof Error ? error.message : "Poll refresh failed"; }
    onError(mutationError);
    onBusy(false);
  };
  return (
    <section aria-label={`Poll: ${poll.question}`} className="mt-2 max-w-lg rounded-xl border border-[var(--border-faint)] bg-white/[0.025] p-3">
      <div className="flex items-start justify-between gap-2"><p className="text-[11px] font-medium text-silver-100">{poll.question}</p><span className="font-mono text-[8px] uppercase text-silver-500">{poll.status}</span></div>
      {poll.status === "open" ? <p className="mt-1 text-[9px] text-silver-500">{poll.allowMultiple ? "Select or deselect any choices." : "Select one choice."}</p> : null}
      <div className="mt-2 space-y-1.5">
        {poll.options.map((option) => (
          <Button key={option.key} size="xs" variant="outline" disabled={busy || poll.status === "closed"} aria-pressed={option.viewerVoted} onClick={() => void mutate(() => voteChorusPoll(organizationKey, channelKey, poll.key, option.key))} className={`w-full justify-between px-2 py-1.5 text-[10px] normal-case tracking-normal focus-visible:outline-2 disabled:cursor-not-allowed ${option.viewerVoted ? "border-silver-400 bg-white/[0.08] text-silver-50" : "border-[var(--border-faint)] text-silver-300"}`}>
            <span>{option.text}</span><span>{option.voteCount}</span>
          </Button>
        ))}
      </div>
      {poll.status === "open" && message.author.type === "user" ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void mutate(() => closeChorusPoll(organizationKey, channelKey, poll.key))} className="mt-2 text-[9px] normal-case tracking-normal">Close poll</Button> : null}
    </section>
  );
}

interface MessageViewProps {
  entry: ChorusChannelEntry;
  message: ChorusDisplayMessage;
  organizationKey: string;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
  onOpenReplies: (message: ChorusMessage) => void;
  onCreatePoll: (message: ChorusMessage) => void;
  onError: (error: string | null) => void;
  onOptimisticReaction: (messageKey: string, reaction: string, active: boolean) => void;
  userName: string;
  countryCode: string;
  mentions: ChorusMention[];
  onOpenActions: (message: ChorusMessage) => void;
}

function MessageContent({ content, mentions }: { content: string; mentions: ChorusMention[] }) {
  const names = new Set(mentions.map((mention) => mention.name.toLocaleLowerCase()));
  return <>{plainChorusText(content).split(/(@[a-z0-9_-]+)/gi).map((part, index) => names.has(part.slice(1).toLocaleLowerCase()) ? <strong key={index} className="font-semibold text-silver-50">{part}</strong> : part)}</>;
}

const MessageView = memo(function MessageView({ entry, message, organizationKey, busy, onBusy, onRefresh, onOpenReplies, onCreatePoll, onError, onOptimisticReaction, userName, countryCode, mentions, onOpenActions }: MessageViewProps) {
  const channelKey = entry.channel!.key;
  const interactive = !message.key.startsWith("optimistic-");
  const react = async (reaction: string, wasActive: boolean) => {
    if (busy) return;
    const active = !wasActive;
    onBusy(true); onError(null); onOptimisticReaction(message.key, reaction, active);
    try {
      const result = await mutateChorusReaction(organizationKey, channelKey, message.key, reaction, active ? "add" : "remove");
      onOptimisticReaction(message.key, reaction, result.active);
    }
    catch (error) { onOptimisticReaction(message.key, reaction, wasActive); onError(error instanceof Error ? error.message : "Reaction failed"); }
    finally { onBusy(false); }
  };
  const openActionsFromMessage = (target: EventTarget | null) => {
    if (!interactive || (target instanceof Element && target.closest("button, input, textarea, select, a"))) return;
    onOpenActions(message);
  };
  return (
    <article role={interactive ? "button" : undefined} tabIndex={interactive ? 0 : undefined} aria-label={interactive ? `Open actions for message from ${message.author.name}` : undefined} onClick={(event) => openActionsFromMessage(event.target)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpenActions(message); } }} onContextMenu={(event) => { event.preventDefault(); onOpenActions(message); }} className={`relative flex gap-3 px-1 py-3 [content-visibility:auto] [contain-intrinsic-size:auto_84px] ${interactive ? "cursor-pointer focus-visible:outline-2 focus-visible:outline-silver-400" : ""}`}>
      {message.author.type === "orchestrator" ? <OrchestratorMark name={message.author.name} size={36} /> : <span aria-label={userName} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-soft)] bg-obsidian-850 font-mono text-[11px] text-silver-200">{userName.trim().charAt(0).toUpperCase() || "?"}</span>}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2"><h3 className="text-[12px] font-medium text-silver-50">{message.author.type === "user" ? "You" : message.author.name}</h3><Timestamp value={message.createdAt} countryCode={countryCode} /></div>
        {message.content ? <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-silver-300"><MessageContent content={message.content} mentions={mentions} /></p> : null}
        {MESSAGE_ACTIONS_ENABLED && interactive ? <PollView organizationKey={organizationKey} channelKey={channelKey} message={message} busy={busy} onBusy={onBusy} onRefresh={onRefresh} onError={onError} /> : null}
        {MESSAGE_ACTIONS_ENABLED && (message.reactions.length > 0 || message.replies.count > 0 || message.poll) ? <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {message.reactions.map((aggregate) => <Button key={aggregate.reaction} size="sm" variant="outline" disabled={busy || !interactive} aria-label={`${aggregate.viewerReacted ? "Remove" : "Add"} ${aggregate.reaction} reaction`} aria-pressed={aggregate.viewerReacted} onClick={() => void react(aggregate.reaction, aggregate.viewerReacted)} className={`px-3 font-mono text-[11px] normal-case tracking-normal focus-visible:outline-2 disabled:opacity-40 ${aggregate.viewerReacted ? "border-silver-400 bg-white/[0.08] text-silver-100" : "border-[var(--border-faint)] text-silver-400"}`}>{aggregate.reaction} {aggregate.count}</Button>)}
          {message.replies.count > 0 ? <Button size="xs" variant="outline" disabled={!interactive} onClick={() => onOpenReplies(message)} className="min-h-0 border-[var(--border-soft)] px-2 py-0.5 text-[9px] normal-case tracking-normal text-silver-300">{message.replies.count} {message.replies.count === 1 ? "reply" : "replies"}</Button> : null}
          {message.poll ? <Button size="xs" variant="outline" disabled={!interactive} onClick={() => onCreatePoll(message)} className="min-h-0 border-[var(--border-soft)] px-2 py-0.5 text-[9px] normal-case tracking-normal text-silver-300">Poll</Button> : null}
        </div> : null}
      </div>
    </article>
  );
});

function PollComposer({ message, onCancel, onCreate, busy, error }: { message: ChorusMessage; onCancel: () => void; onCreate: (question: string, options: string[], allowMultiple: boolean) => Promise<void>; busy: boolean; error: string | null }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const validOptions = options.map((option) => option.trim()).filter(Boolean);
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-obsidian-990/65" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-2xl border border-[var(--border-strong)] bg-obsidian-950 p-5 shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[420px] sm:max-h-none sm:rounded-none" aria-describedby={undefined}>
    <form onSubmit={(event) => { event.preventDefault(); const prompt = question.trim(); if (!prompt) { setFormError("Add a question."); return; } if (validOptions.length < 2) { setFormError("Add at least two options."); return; } if (new Set(validOptions.map((option) => option.toLocaleLowerCase())).size !== validOptions.length) { setFormError("Poll options must be unique."); return; } setFormError(null); void onCreate(prompt, validOptions, allowMultiple); }} aria-label={`Create poll for message: ${message.content.slice(0, 40)}`} className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-between"><Dialog.Title className="text-xs text-silver-100">Create poll</Dialog.Title><Dialog.Close asChild><Button variant="icon" disabled={busy} aria-label="Cancel poll creation" icon={<CloseIcon size="sm" />} className="h-8 min-h-0 w-8">Cancel poll creation</Button></Dialog.Close></div>
       <input autoFocus value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} placeholder="Question" aria-label="Poll question" className="mt-5 w-full rounded-md border border-[var(--border-faint)] bg-white/[0.04] px-3 py-2 text-[11px] text-white outline-none focus:border-silver-500" />
       <div className="mt-3 space-y-3">{options.map((option, index) => <input key={index} value={option} onChange={(event) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} maxLength={200} placeholder={`Option ${index + 1}`} aria-label={`Poll option ${index + 1}`} className="w-full rounded-md border border-[var(--border-faint)] bg-white/[0.04] px-3 py-2 text-[11px] text-white outline-none focus:border-silver-500" />)}</div>
        <div className="mt-4 flex items-center justify-between"><Button type="button" size="sm" variant="secondary" aria-pressed={allowMultiple} onClick={() => { setAllowMultiple((current) => !current); setFormError(null); }} className={`min-h-0 px-3 py-1.5 text-[10px] normal-case tracking-normal ${allowMultiple ? "border-silver-400 bg-white/[0.08] text-silver-50" : ""}`}>Multiple choices</Button>{options.length < 10 ? <Button type="button" size="sm" variant="secondary" onClick={() => { setOptions((current) => [...current, ""]); setFormError(null); }} className="min-h-0 px-3 py-1.5 text-[10px] normal-case tracking-normal">Add option</Button> : null}</div>
       {formError ?? error ? <p role="alert" className="mt-2 text-[10px] text-status-critical">{formError ?? error}</p> : null}
        <div className="mt-auto border-t border-[var(--border-faint)] pt-4"><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onCancel} className="min-h-0 px-4 py-2 text-[10px]">Close</Button><Button type="submit" variant="primary" disabled={busy} className="min-h-0 px-4 py-2 text-[10px]">Create poll</Button></div></div>
    </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface MessageComposerProps {
  organizationKey: string;
  channelKey: string | null;
  orchestratorName: string | null;
  canChat: boolean;
  streaming: boolean;
  onSubmit: (content: string) => void;
  onTypingChange: (active: boolean) => void;
  mentions: ChorusMention[];
  mentionRoster: ChorusMentionRoster | null;
  channelDrafts: Map<string, string>;
  draftId: string;
}

const MessageComposer = memo(function MessageComposer({ organizationKey, channelKey, orchestratorName, canChat, streaming, onSubmit, onTypingChange, mentions, mentionRoster, channelDrafts, draftId }: MessageComposerProps) {
  const draftKey = channelKey ? `${organizationKey}:${channelKey}:${draftId}` : null;
  const [draft, setDraft] = useState(() => draftKey ? channelDrafts.get(draftKey) ?? "" : "");
  const [recording, setRecording] = useState(false);
  const [startingRecording, setStartingRecording] = useState(false);
  const [speechLevel, setSpeechLevel] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [, setVoiceError] = useState<string | null>(null);
  const capture = useRef<PcmCapture | null>(null);
  const captureGeneration = useRef(0);
  const transcription = useRef<AbortController | null>(null);
  const mentionMatch = /(?:^|[^\w])@([\w-]*)$/i.exec(draft);
  const query = activeChorusMentionQuery(draft);
  const rosterRows = mentionRoster ? buildChorusMentionRows(mentionRoster) : { orchestrators: [], people: [] };
  const serverOrchestrators = new Map(rosterRows.orchestrators.map((mention) => [mention.name, mention]));
  const orchestrators: ChorusMention[] = CHORUS_ORCHESTRATOR_NAMES.map((name) => serverOrchestrators.get(name) ?? { participantKey: `canonical-${name.toLowerCase()}`, type: "orchestrator", key: `canonical-${name.toLowerCase()}`, name, role: "Orchestrator", mentionCount: 0 });
  const people = rosterRows.people;
  const visiblePeople = filterChorusMentionShortcuts(people, query);
  const visibleOrchestrators = filterChorusMentionShortcuts(orchestrators, query);
  const visible = [...visiblePeople, ...visibleOrchestrators];
  const completion = closestChorusMentionCompletion([...orchestrators, ...people], draft);
  useEffect(() => () => { captureGeneration.current += 1; capture.current?.cancel(); transcription.current?.abort(); }, []);
  const typing = Boolean(draft.trim()) && canChat && !streaming;
  useEffect(() => {
    onTypingChange(typing);
    if (!typing) return;
    const heartbeat = setInterval(() => onTypingChange(true), 2_500);
    return () => { clearInterval(heartbeat); onTypingChange(false); };
  }, [onTypingChange, typing]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !channelKey || !canChat || streaming || recording || startingRecording || transcribing) return;
    channelDrafts.set(draftKey!, "");
    setDraft("");
    onSubmit(content);
  };

  const insertMention = (name: string) => {
    const next = mentionMatch ? draft.replace(/(^|[^\w])@([\w-]*)$/i, `$1@${name} `) : `${draft}${draft && !/\s$/.test(draft) ? " " : ""}@${name} `;
    setDraft(next); if (draftKey) channelDrafts.set(draftKey, next);
  };
  const applyTranscript = async (audioBase64: string) => {
    if (!draftKey) return;
    const controller = new AbortController(); transcription.current?.abort(); transcription.current = controller;
    setTranscribing(true); setVoiceError(null);
    try {
      const text = await transcribeChorusAudio(organizationKey, audioBase64, controller.signal);
      if (controller.signal.aborted) return;
      setDraft((current) => {
        const next = appendSpokenTranscript(current, text, mentions);
        channelDrafts.set(draftKey, next);
        return next;
      });
    } catch (transcriptionError) {
      if (!controller.signal.aborted) setVoiceError(transcriptionError instanceof Error ? transcriptionError.message : "Speech could not be transcribed");
    } finally {
      if (transcription.current === controller) { transcription.current = null; setTranscribing(false); }
    }
  };
  const toggleRecording = async () => {
    if (capture.current) {
      const active = capture.current; capture.current = null; setRecording(false);
      try { await applyTranscript(await active.stop()); }
      catch (captureError) { setVoiceError(captureError instanceof Error ? captureError.message : "Speech could not be recorded"); }
      return;
    }
    if (!channelKey || !canChat || transcribing || startingRecording) return;
    const generation = ++captureGeneration.current;
    setStartingRecording(true);
    setVoiceError(null);
    try {
      const started = await startPcmCapture(setSpeechLevel, (audioBase64) => {
        capture.current = null; setRecording(false); void applyTranscript(audioBase64);
      }, (limitError) => {
        capture.current = null; setRecording(false);
        setVoiceError(limitError instanceof Error ? limitError.message : "Speech could not be recorded");
      });
      if (captureGeneration.current !== generation) { started.cancel(); return; }
      capture.current = started;
      setRecording(true);
    } catch (captureError) {
      if (captureGeneration.current === generation) setVoiceError(captureError instanceof Error ? captureError.message : "Microphone access failed");
    } finally { if (captureGeneration.current === generation) setStartingRecording(false); }
  };
  const placeholder = orchestratorName
    ? canChat ? "Message #general..." : `Chat permission required for ${orchestratorName}`
    : "Select a channel";

  return (
    <div className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
      <form onSubmit={submit} aria-busy={startingRecording || transcribing || streaming} className="rounded-xl border border-[var(--border-soft)] bg-obsidian-900/90 p-3 focus-within:border-[var(--border-strong)]">
        <div className="relative min-h-10">
          {completion ? <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words font-sans text-[12px] leading-5 text-transparent select-none">{draft}<span className="text-silver-600">{completion.suffix}</span></div> : null}
          <Textarea
            value={draft}
            onChange={(event) => {
              const value = event.target.value;
              setDraft(value);
              if (draftKey) channelDrafts.set(draftKey, value);
            }}
            onKeyDown={(event) => {
              const caretAtEnd = event.currentTarget.selectionStart === draft.length && event.currentTarget.selectionEnd === draft.length;
              const acceptCompletion = completion && !event.nativeEvent.isComposing && (
                (event.key === "Tab" && caretAtEnd)
                || (event.key === "Enter" && !event.shiftKey && caretAtEnd)
                || (event.key === "ArrowRight" && caretAtEnd)
              );
              if (acceptCompletion) {
                event.preventDefault();
                insertMention(completion.mention.name);
                return;
              }
              if (event.key === "Tab" && caretAtEnd && mentionMatch && visible[0]) {
                event.preventDefault();
                insertMention(visible[0].name);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={!canChat || !channelKey}
            rows={2}
            maxLength={8000}
            placeholder={placeholder}
            aria-label={orchestratorName ? `Message ${orchestratorName}` : "Message"}
            aria-autocomplete="inline"
            className="relative z-10 block !min-h-10 w-full resize-none !rounded-none !border-0 !bg-transparent !p-0 !text-[12px] leading-5 text-silver-100 !shadow-none outline-none placeholder:text-silver-500 disabled:cursor-not-allowed"
          />
          <span className="sr-only" aria-live="polite">{completion ? `Suggested mention ${completion.mention.name}. Press Tab, Right Arrow, or Enter to complete.` : ""}</span>
        </div>
        <div className="mt-2 flex min-h-8 items-center justify-end gap-3">
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="icon" onClick={() => void toggleRecording()} disabled={!canChat || !channelKey || transcribing || startingRecording} aria-label={transcribing ? "Transcribing message" : startingRecording ? "Starting microphone" : recording ? "Stop speaking and transcribe" : "Speak into message"} aria-pressed={recording} icon={transcribing || startingRecording ? <Spinner className="h-4 w-4" /> : <MicrophoneIcon size="sm" className={recording && speechLevel > 0.015 ? "scale-110" : undefined} />} className={`h-11 min-h-11 w-11 rounded-lg ${recording ? "border-silver-200 bg-white/[0.1] text-silver-50" : "text-silver-400"}`}>{recording ? "Stop speaking and transcribe" : "Speak into message"}</Button>
            <Button type="submit" variant="primary" disabled={!canChat || !channelKey || streaming || recording || startingRecording || transcribing || !draft.trim()} aria-label={orchestratorName ? `Send message to ${orchestratorName}` : "Send message"} icon={<SendIcon aria-hidden size="sm" strokeWidth={1.9} />} className="h-11 min-h-11 w-11 rounded-lg p-0 disabled:opacity-80" />
          </div>
        </div>
      </form>
      <div aria-label="Mention shortcuts" className="mt-2 flex w-full min-w-0 flex-nowrap gap-1.5 overflow-x-auto overscroll-x-contain pb-1">
        {visiblePeople.map((mention) => <Button key={`${mention.type}:${mention.key}`} aria-label={`Mention ${mention.name}`} size="xs" variant="secondary" onClick={() => insertMention(mention.name)} className="min-h-0 shrink-0 border-[var(--border-soft)] px-2 py-1 font-mono text-[10px] normal-case tracking-normal text-silver-200 hover:border-silver-500">@{mention.name === "everyone" ? "everyone" : mention.name}</Button>)}
        {visibleOrchestrators.map((mention) => <Button key={`orchestrator:${mention.key}`} aria-label={`Mention ${mention.name}`} size="xs" variant="secondary" onClick={() => insertMention(mention.name)} className="min-h-0 shrink-0 border-[var(--border-soft)] px-2 py-1 font-mono text-[10px] normal-case tracking-normal text-silver-200 hover:border-silver-500">@{mention.name}</Button>)}
      </div>
    </div>
  );
});

export default function HqCommunicationOverlay({ organizationKey, organizationOptions, onOrganizationChange, userName, countryCode, selectedScopeId, onScopeChange }: HqCommunicationOverlayProps) {
  const [channels, setChannels] = useState<ChorusChannelEntry[]>([]);
  const [mentions, setMentions] = useState<ChorusMention[]>([]);
  const [mentionRoster, setMentionRoster] = useState<ChorusMentionRoster | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, ChorusDisplayMessage[]>>({});
  const [messagesLoading, setMessagesLoading] = useState<Record<string, boolean>>({});
  const [streaming, setStreaming] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [pollMessage, setPollMessage] = useState<ChorusMessage | null>(null);
  const [actionMessage, setActionMessage] = useState<ChorusMessage | null>(null);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [reactionQuery, setReactionQuery] = useState("");
  const [frequentReactions, setFrequentReactions] = useState<Array<{ reaction: string; count: number }>>([]);
  const [replyState, setReplyState] = useState<{ parents: ChorusDisplayMessage[]; messages: ChorusDisplayMessage[]; loading: boolean; error: string | null } | null>(null);
  const [typingParticipants, setTypingParticipants] = useState<Record<string, ChorusTypingEvent>>({});
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const messageRequests = useRef(new Map<string, number>());
  const messageActionRevisions = useRef(new Map<string, number>());
  const reactionRequests = useRef(new Set<string>());
  const streamingChannels = useRef(new Set<string>());
  const organizationGeneration = useRef(0);
  const replyGeneration = useRef(0);
  const currentOrganization = useRef(organizationKey);
  const activeChannel = useRef<string | null>(null);
  const messagesPane = useRef<HTMLDivElement>(null);
  const emojiPicker = useRef<HTMLDivElement>(null);
  const channelDrafts = useRef(new Map<string, string>());
  const stopVoice = useAudioStore((state) => state.stopVoice);
  const voicePlayingSrc = useAudioStore((state) => state.voicePlayingSrc);
  const pendingVoiceSrc = useAudioStore((state) => state.pendingVoiceSrc);
  const playVoice = useAudioStore((state) => state.playVoice);
  const speechAudio = useRef(new Map<string, string>());
  const speechRequest = useRef<AbortController | null>(null);
  currentOrganization.current = organizationKey;

  const loadChannels = useCallback(async () => {
    const generation = ++organizationGeneration.current;
    currentOrganization.current = organizationKey;
    replyGeneration.current += 1;
    for (const active of controllers.current.values()) active.abort();
    controllers.current.clear();
    messageRequests.current.clear(); messageActionRevisions.current.clear(); reactionRequests.current.clear(); streamingChannels.current.clear();
    activeChannel.current = null;
    setChannels([]); setMentions([]); setMentionRoster(null); setMessages({}); setMessagesLoading({}); setStreaming({}); setErrors({}); setSelectedKey(null); setReplyState(null); setPollMessage(null); setBusyMessage(null); setClearOpen(false); setFrequentReactions([]);
    setChannelsLoading(true); setChannelsError(null);
    const controller = new AbortController();
    controllers.current.get("channels")?.abort(); controllers.current.set("channels", controller);
    try {
      const loaded = await listChorusChannels(organizationKey, controller.signal);
      if (controller.signal.aborted || organizationGeneration.current !== generation || currentOrganization.current !== organizationKey) return;
      setChannels(loaded.channels); setMentions(loaded.mentions); setMentionRoster(loaded.mentionRoster);
      setSelectedKey((current) => loaded.channels.some((entry) => entry.orchestrator.key === current) ? current : loaded.channels[0]?.orchestrator.key ?? null);
      setFrequentReactions(await listChorusFrequentReactions(organizationKey, controller.signal).catch(() => []));
    } catch (error) { if (!controller.signal.aborted && organizationGeneration.current === generation) setChannelsError(error instanceof Error ? error.message : "Channels could not load"); }
    finally { if (!controller.signal.aborted && organizationGeneration.current === generation) setChannelsLoading(false); }
  }, [organizationKey]);

  const refreshMessages = useCallback(async (channelKey: string, preserveTransient = true) => {
    const generation = organizationGeneration.current;
    const requestOrganization = organizationKey;
    const requestId = (messageRequests.current.get(channelKey) ?? 0) + 1;
    const actionRevision = messageActionRevisions.current.get(channelKey) ?? 0;
    messageRequests.current.set(channelKey, requestId);
    setMessagesLoading((current) => ({ ...current, [channelKey]: true }));
    const controller = new AbortController();
    controllers.current.get(`messages:${channelKey}`)?.abort(); controllers.current.set(`messages:${channelKey}`, controller);
    try {
      const loaded = await listChorusMessages(organizationKey, channelKey, controller.signal);
      if (!controller.signal.aborted && organizationGeneration.current === generation && currentOrganization.current === requestOrganization && messageRequests.current.get(channelKey) === requestId) {
        setMessages((current) => ({ ...current, [channelKey]: mergeChorusMessageRefresh(current[channelKey] ?? [], loaded, preserveTransient, (messageActionRevisions.current.get(channelKey) ?? 0) !== actionRevision) }));
        setErrors((current) => ({ ...current, [channelKey]: null }));
      }
    } catch (error) {
      if (controller.signal.aborted) {
        if (!preserveTransient && organizationGeneration.current === generation && currentOrganization.current === requestOrganization) throw new Error("Canonical message refresh was interrupted");
        return;
      }
      if (!controller.signal.aborted && organizationGeneration.current === generation) {
        const message = error instanceof Error ? error.message : "Messages could not load";
        setErrors((current) => ({ ...current, [channelKey]: message }));
        throw error;
      }
    } finally {
      if (!controller.signal.aborted && organizationGeneration.current === generation && currentOrganization.current === requestOrganization && messageRequests.current.get(channelKey) === requestId) setMessagesLoading((current) => ({ ...current, [channelKey]: false }));
    }
  }, [organizationKey]);

  useEffect(() => { void loadChannels(); }, [loadChannels]);
  useEffect(() => { void loadEmojiPicker(); }, []);
  useEffect(() => () => { for (const controller of controllers.current.values()) controller.abort(); }, []);
  useEffect(() => {
    if (!reactionPickerOpen) return;
    const controller = new AbortController();
    void listChorusFrequentReactions(organizationKey, controller.signal).then(setFrequentReactions).catch(() => {});
    return () => controller.abort();
  }, [organizationKey, reactionPickerOpen]);
  useEffect(() => {
    if (!reactionPickerOpen) return;
    const syncPickerSearch = () => {
      const input = emojiPicker.current?.querySelector<HTMLInputElement>("input.epr-search");
      if (!input || input.value === reactionQuery) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, reactionQuery);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const frame = requestAnimationFrame(syncPickerSearch);
    const observer = new MutationObserver(syncPickerSearch);
    if (emojiPicker.current) observer.observe(emojiPicker.current, { childList: true, subtree: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [reactionPickerOpen, reactionQuery]);

  const selected = channels.find((entry) => entry.orchestrator.key === selectedKey) ?? null;
  const channelKey = selected?.channel?.key ?? null;
  const selectedMessages = channelKey ? messages[channelKey] : undefined;
  const activeReplyParentKey = replyState?.parents.at(-1)?.key ?? null;
  const hasReplyState = Boolean(replyState);
  const scrollMessages = replyState?.messages ?? selectedMessages;
  activeChannel.current = channelKey;
  useEffect(() => {
    setTypingParticipants({});
    if (!channelKey) return;
    let active = true;
    const unsubscribe = subscribeChorusTyping(organizationKey, channelKey, (event) => {
      if (!active) return;
      setTypingParticipants((current) => {
        const next = { ...current };
        if (event.active && event.expiresAt > Date.now()) next[event.participantKey] = event;
        else delete next[event.participantKey];
        return next;
      });
    });
    const prune = setInterval(() => setTypingParticipants((current) => Object.fromEntries(Object.entries(current).filter(([, event]) => event.expiresAt > Date.now()))), 1_000);
    return () => { active = false; clearInterval(prune); unsubscribe(); };
  }, [channelKey, organizationKey]);
  useEffect(() => { if (selected?.canChat && channelKey) void refreshMessages(channelKey).catch(() => {}); }, [selectedKey, channelKey, selected?.canChat, refreshMessages]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const pane = messagesPane.current;
      if (pane) pane.scrollTop = pane.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [channelKey, scrollMessages]);
  useEffect(() => () => { speechRequest.current?.abort(); stopVoice(); for (const url of speechAudio.current.values()) URL.revokeObjectURL(url); speechAudio.current.clear(); }, [organizationKey, channelKey, stopVoice]);

  const selectChannel = useCallback((entry: ChorusChannelEntry) => {
    replyGeneration.current += 1;
    controllers.current.get("replies")?.abort();
    activeChannel.current = entry.channel?.key ?? null;
    setSelectedKey(entry.orchestrator.key); setPollMessage(null); setReplyState(null); setClearOpen(false);
    if (entry.orchestrator.key === selectedKey && entry.canChat && entry.channel) void refreshMessages(entry.channel.key).catch(() => {});
  }, [refreshMessages, selectedKey]);
  const retryChannels = useCallback(() => { void loadChannels(); }, [loadChannels]);

  const submitMessage = useCallback(async (content: string) => {
    if (!selected?.canChat || !channelKey || streaming[channelKey] || !content) return;
    const now = new Date().toISOString();
    const userKey = `optimistic-user-${crypto.randomUUID()}`;
    const streamKey = crypto.randomUUID();
    const stream = { streamKey, userKey, channelKey };
    const generation = organizationGeneration.current;
    const user: ChorusDisplayMessage = { key: userKey, channelKey, content, createdAt: now, updatedAt: now, author: { participantKey: "optimistic", type: "user", key: "optimistic", name: "You" }, reactions: [], replies: { count: 0 }, poll: null, clientState: { streamKey, state: "optimistic" } };
    setMessages((current) => ({ ...current, [channelKey]: [...(current[channelKey] ?? []), user] }));
    streamingChannels.current.add(channelKey);
    setErrors((current) => ({ ...current, [channelKey]: null })); setStreaming((current) => ({ ...current, [channelKey]: true }));
    const controller = new AbortController(); controllers.current.set(`stream:${channelKey}`, controller);
    const eventBatcher = createFrameBatcher<ChorusStreamEvent>((events) => {
      if (organizationGeneration.current !== generation || currentOrganization.current !== organizationKey) return;
      setMessages((current) => ({ ...current, [channelKey]: coalesceChorusStreamEvents(events).reduce((channelMessages, streamEvent) => reconcileChorusStreamEvent(channelMessages, stream, streamEvent), current[channelKey] ?? []) }));
    });
    try {
      await streamChorusMessage(organizationKey, channelKey, content, (streamEvent) => {
        if (organizationGeneration.current !== generation || currentOrganization.current !== organizationKey) return;
        if ((streamEvent.type === "start" && streamEvent.channelKey !== channelKey) || (streamEvent.type === "done" && streamEvent.message.channelKey !== channelKey)) throw new Error("Chorus stream returned a message for another channel");
        if (streamEvent.type === "assistant-error") setErrors((current) => ({ ...current, [channelKey]: "An orchestrator response could not be saved. Please try again." }));
        eventBatcher.push(streamEvent);
        if (streamEvent.type === "done" || streamEvent.type === "complete") eventBatcher.flush();
      }, controller.signal);
      eventBatcher.flush();
      try {
        await refreshMessages(channelKey, false);
      } catch (error) {
        const message = error instanceof Error ? `Sent, but canonical refresh failed: ${error.message}` : "Sent, but canonical refresh failed";
        if (organizationGeneration.current === generation && currentOrganization.current === organizationKey) setMessages((current) => ({ ...current, [channelKey]: markChorusStreamFailed(current[channelKey] ?? [], streamKey, message) }));
      }
    } catch (error) {
      eventBatcher.flush();
      if (!controller.signal.aborted && organizationGeneration.current === generation) {
        const message = error instanceof Error ? error.message : "Message failed";
        try { await refreshMessages(channelKey, false); }
        catch { setMessages((current) => ({ ...current, [channelKey]: markChorusStreamFailed(current[channelKey] ?? [], streamKey, message) })); }
        setErrors((current) => ({ ...current, [channelKey]: message }));
      }
    } finally {
      eventBatcher.cancel();
      controllers.current.delete(`stream:${channelKey}`);
      streamingChannels.current.delete(channelKey);
      if (organizationGeneration.current === generation) setStreaming((current) => ({ ...current, [channelKey]: false }));
    }
  }, [channelKey, organizationKey, refreshMessages, selected, streaming]);
  const submitComposerMessage = useCallback((content: string) => { void submitMessage(content); }, [submitMessage]);
  const publishTyping = useCallback((active: boolean) => { if (channelKey) void publishChorusTyping(organizationKey, channelKey, active).catch(() => {}); }, [channelKey, organizationKey]);

  const openReplies = async (message: ChorusDisplayMessage) => {
    if (!channelKey) return;
    const generation = ++replyGeneration.current;
    const requestOrganization = organizationKey;
    const parents = replyState ? [...replyState.parents, message] : [message];
    const controller = new AbortController();
    controllers.current.get("replies")?.abort(); controllers.current.set("replies", controller);
    setErrors((current) => ({ ...current, [channelKey]: null }));
    setReplyState({ parents, messages: replyState?.messages ?? [message], loading: true, error: null });
    try {
      const loaded = await readChorusReplies(organizationKey, channelKey, message.key, controller.signal);
      if (controller.signal.aborted || replyGeneration.current !== generation || activeChannel.current !== channelKey || currentOrganization.current !== requestOrganization) return;
      const canonicalParent = loaded.messages.find((candidate) => candidate.key === message.key) ?? message;
      setReplyState({ parents: [...parents.slice(0, -1), canonicalParent], messages: loaded.messages, loading: false, error: null });
      await refreshMessages(channelKey).catch(() => {});
    } catch (error) {
      if (!controller.signal.aborted && replyGeneration.current === generation) setReplyState((current) => current ? { ...current, loading: false, error: error instanceof Error ? error.message : "Replies could not open" } : current);
    }
  };

  const refreshReplies = useCallback(async () => {
    const parentKey = activeReplyParentKey;
    if (!channelKey || !parentKey) return;
    const generation = replyGeneration.current;
    const requestOrganization = organizationKey;
    const controller = new AbortController();
    controllers.current.get("replies-refresh")?.abort(); controllers.current.set("replies-refresh", controller);
    try {
      const loaded = await readChorusReplies(organizationKey, channelKey, parentKey, controller.signal);
      if (controller.signal.aborted || replyGeneration.current !== generation || activeChannel.current !== channelKey || currentOrganization.current !== requestOrganization) return;
      setReplyState((current) => current?.parents.at(-1)?.key === parentKey ? {
        ...current,
        parents: current.parents.map((parent) => loaded.messages.find((message) => message.key === parent.key) ?? parent),
        messages: loaded.messages,
        loading: false,
        error: null,
      } : current);
    } catch (error) {
      if (!controller.signal.aborted && replyGeneration.current === generation) setReplyState((current) => current?.parents.at(-1)?.key === parentKey ? { ...current, error: error instanceof Error ? error.message : "Replies could not refresh" } : current);
      throw error;
    }
  }, [activeReplyParentKey, channelKey, organizationKey]);

  const submitReply = async (content: string) => {
    const parent = replyState?.parents.at(-1);
    if (!channelKey || !replyState || !parent || streaming[channelKey] || !content) return;
    const generation = organizationGeneration.current;
    const requestReplyGeneration = replyGeneration.current;
    const parentKey = parent.key;
    const now = new Date().toISOString();
    const userKey = `optimistic-user-${crypto.randomUUID()}`;
    const stream = { streamKey: crypto.randomUUID(), userKey, channelKey };
    const user: ChorusDisplayMessage = { key: userKey, channelKey, threadKey: parent.threadKey, replyToMessageKey: parentKey, content, createdAt: now, updatedAt: now, author: { participantKey: "optimistic", type: "user", key: "optimistic", name: "You" }, reactions: [], replies: { count: 0 }, poll: null, clientState: { streamKey: stream.streamKey, state: "optimistic" } };
    setReplyState((current) => current ? { ...current, messages: [...current.messages, user] } : current);
    streamingChannels.current.add(channelKey);
    setStreaming((current) => ({ ...current, [channelKey]: true }));
    const controller = new AbortController(); controllers.current.set(`reply-stream:${channelKey}`, controller);
    const eventBatcher = createFrameBatcher<ChorusStreamEvent>((events) => {
      if (organizationGeneration.current !== generation || replyGeneration.current !== requestReplyGeneration) return;
      setReplyState((current) => current?.parents.at(-1)?.key === parentKey ? { ...current, messages: coalesceChorusStreamEvents(events).reduce((items, event) => reconcileChorusStreamEvent(items, stream, event), current.messages) } : current);
    });
    try {
      await streamChorusMessage(organizationKey, channelKey, content, (event) => {
        eventBatcher.push(event);
        if (event.type === "done" || event.type === "complete") eventBatcher.flush();
      }, controller.signal, parent.threadKey, parentKey);
      eventBatcher.flush();
      if (replyGeneration.current !== requestReplyGeneration || replyState.parents.at(-1)?.key !== parentKey) return;
      await refreshReplies();
      await refreshMessages(channelKey).catch(() => {});
    } catch {
      eventBatcher.flush();
      if (!controller.signal.aborted && replyGeneration.current === requestReplyGeneration) {
        try { await refreshReplies(); }
        catch { setReplyState((current) => current?.parents.at(-1)?.key === parentKey ? { ...current, messages: markChorusStreamFailed(current.messages, stream.streamKey, "Message reconciliation failed") } : current); }
      }
    } finally {
      eventBatcher.cancel(); controllers.current.delete(`reply-stream:${channelKey}`); streamingChannels.current.delete(channelKey);
      if (organizationGeneration.current === generation) setStreaming((current) => ({ ...current, [channelKey]: false }));
    }
  };

  const backFromReplies = async () => {
    if (!replyState || replyState.parents.length <= 1 || !channelKey) {
      replyGeneration.current += 1;
      if (channelKey) controllers.current.get(`reply-stream:${channelKey}`)?.abort();
      setReplyState(null);
      return;
    }
    const generation = ++replyGeneration.current;
    controllers.current.get(`reply-stream:${channelKey}`)?.abort();
    const parents = replyState.parents.slice(0, -1);
    const parent = parents.at(-1)!;
    const requestOrganization = organizationKey;
    const controller = new AbortController();
    controllers.current.get("replies")?.abort(); controllers.current.set("replies", controller);
    setReplyState({ parents, messages: [parent], loading: true, error: null });
    try {
      const loaded = await readChorusReplies(organizationKey, channelKey, parent.key, controller.signal);
      if (controller.signal.aborted || replyGeneration.current !== generation || activeChannel.current !== channelKey || currentOrganization.current !== requestOrganization) return;
      setReplyState({ parents: parents.map((ancestor) => loaded.messages.find((message) => message.key === ancestor.key) ?? ancestor), messages: loaded.messages, loading: false, error: null });
    } catch (error) {
      if (!controller.signal.aborted && replyGeneration.current === generation) setReplyState((current) => current ? { ...current, loading: false, error: error instanceof Error ? error.message : "Replies could not open" } : current);
    }
  };

  const visibleMessages = (selectedMessages ?? []).filter((message) => !message.threadKey && !message.replyToMessageKey);
  const replyParent = replyState?.parents.at(-1) ?? null;
  const displayedMessages = replyState && replyParent
    ? [replyState.messages.find((message) => message.key === replyParent.key) ?? replyParent, ...directChorusReplies(replyState.messages, replyParent)]
    : visibleMessages;
  const typingLabel = formatChorusTypingLabel(Object.values(typingParticipants).map(({ name }) => name));
  const updateMessageActions = (messageKey: string, updateMessage: (message: ChorusMessage) => ChorusMessage) => {
    if (!channelKey) return;
    messageActionRevisions.current.set(channelKey, (messageActionRevisions.current.get(channelKey) ?? 0) + 1);
    const update = (items: ChorusMessage[]) => items.map((message) => message.key === messageKey ? updateMessage(message) : message);
    setMessages((current) => ({ ...current, [channelKey]: update(current[channelKey] ?? []) }));
    setReplyState((current) => current ? { ...current, messages: update(current.messages), parents: update(current.parents) } : current);
  };
  const optimisticallySetReaction = (messageKey: string, reaction: string, active: boolean) => {
    const update = (items: ChorusMessage[]) => setChorusReactionState(items, messageKey, reaction, active);
    if (channelKey) messageActionRevisions.current.set(channelKey, (messageActionRevisions.current.get(channelKey) ?? 0) + 1);
    if (channelKey) setMessages((current) => ({ ...current, [channelKey]: update(current[channelKey] ?? []) }));
    setReplyState((current) => current ? { ...current, messages: update(current.messages), parents: update(current.parents) } : current);
  };
  const selectReaction = async (reaction: string) => {
    if (!actionMessage || !channelKey) return;
    const messageKey = actionMessage.key;
    const requestChannel = channelKey;
    const requestKey = `${organizationKey}:${requestChannel}:${messageKey}:${reaction}`;
    if (reactionRequests.current.has(requestKey)) return;
    reactionRequests.current.add(requestKey);
    const wasActive = actionMessage.reactions.some((item) => item.reaction === reaction && item.viewerReacted);
    setBusyMessage(messageKey);
    setErrors((current) => ({ ...current, [requestChannel]: null }));
    optimisticallySetReaction(messageKey, reaction, true);
    setReactionPickerOpen(false); setActionMessage(null);
    try {
      const result = await mutateChorusReaction(organizationKey, requestChannel, messageKey, reaction, "add");
      optimisticallySetReaction(messageKey, reaction, result.active);
      setFrequentReactions(await listChorusFrequentReactions(organizationKey).catch(() => frequentReactions));
    } catch (error) {
      optimisticallySetReaction(messageKey, reaction, wasActive);
      setErrors((current) => ({ ...current, [requestChannel]: error instanceof Error ? error.message : "Reaction failed" }));
    } finally {
      reactionRequests.current.delete(requestKey);
      setBusyMessage((current) => current === messageKey ? null : current);
    }
  };
  const clearSelectedChannel = async () => {
    if (!channelKey || clearing || streaming[channelKey]) return;
    const requestChannel = channelKey;
    setClearing(true);
    setErrors((current) => ({ ...current, [requestChannel]: null }));
    controllers.current.get(`messages:${requestChannel}`)?.abort();
    messageRequests.current.set(requestChannel, (messageRequests.current.get(requestChannel) ?? 0) + 1);
    try {
      await clearChorusChannel(organizationKey, requestChannel);
      if (activeChannel.current === requestChannel) {
        setMessages((current) => ({ ...current, [requestChannel]: [] }));
        setClearOpen(false);
      }
    } catch (error) {
      if (activeChannel.current === requestChannel) setErrors((current) => ({ ...current, [requestChannel]: error instanceof Error ? error.message : "Channel could not be cleared" }));
    } finally {
      setClearing(false);
    }
  };
  const stopMessageSpeech = () => {
    speechRequest.current?.abort(); speechRequest.current = null; stopVoice(); setBusyMessage(null);
  };
  const closeMessageActions = () => {
    stopMessageSpeech(); setActionMessage(null);
  };
  const toggleMessageSpeech = async () => {
    if (!actionMessage) return;
    const existing = speechAudio.current.get(actionMessage.key);
    if (existing) { playVoice(existing); return; }
    const controller = new AbortController(); speechRequest.current?.abort(); speechRequest.current = controller;
    setBusyMessage(actionMessage.key);
    try {
      const url = await synthesizeChorusSpeech(organizationKey, plainChorusText(actionMessage.content), controller.signal);
      if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }
      for (const cached of speechAudio.current.values()) URL.revokeObjectURL(cached);
      speechAudio.current.clear();
      speechAudio.current.set(actionMessage.key, url); playVoice(url);
    } catch (speechError) {
      if (!controller.signal.aborted && channelKey) setErrors((current) => ({ ...current, [channelKey]: speechError instanceof Error ? speechError.message : "Message playback failed" }));
    } finally {
      if (speechRequest.current === controller) { speechRequest.current = null; setBusyMessage(null); }
    }
  };
  const deleteSelectedMessage = async () => {
    if (!actionMessage || !channelKey) return;
    const messageKey = actionMessage.key;
    closeMessageActions();
    try {
      await deleteChorusMessage(organizationKey, channelKey, messageKey);
      if (activeReplyParentKey === messageKey) await backFromReplies();
      await Promise.all([refreshMessages(channelKey), activeReplyParentKey && activeReplyParentKey !== messageKey ? refreshReplies() : Promise.resolve()]);
    } catch (error) {
      setErrors((current) => ({ ...current, [channelKey]: error instanceof Error ? error.message : "Message could not be deleted" }));
    }
  };
  useEffect(() => subscribeNexusInvalidations(organizationKey, (event) => {
    if (event.resource?.type !== "messages" || (event.slug !== "chorus.message.create" && event.slug !== "chorus.message.remove")) return;
    if (channelKey && streamingChannels.current.has(channelKey)) return;
    if (event.slug === "chorus.message.remove" && hasReplyState && (event.resource.key === activeReplyParentKey || event.resource.key === channelKey)) {
      replyGeneration.current += 1;
      setReplyState(null);
    }
    if (channelKey) void refreshMessages(channelKey).catch(() => {});
    if (activeReplyParentKey && event.resource.key !== activeReplyParentKey && event.resource.key !== channelKey) void refreshReplies().catch(() => {});
  }), [activeReplyParentKey, channelKey, hasReplyState, organizationKey, refreshMessages, refreshReplies]);
  return (
    <div data-scope-id={selectedScopeId} className="pointer-events-auto absolute inset-0 z-10 flex min-h-0 flex-col p-1.5 sm:p-2.5">
      <header className="flex h-12 shrink-0 items-center border border-[var(--border-faint)] bg-obsidian-990/90 px-3 sm:h-14 sm:px-4">
        <ScopeMark entity={VORINTHEX_GALAXY_REGISTRY.products.hq} size={24} />
      </header>
      <div className="relative grid min-h-0 flex-1 grid-rows-[minmax(150px,30vh)_minmax(0,1fr)] overflow-hidden border-x border-b border-[var(--border-faint)] md:grid-cols-[248px_minmax(0,1fr)] md:grid-rows-1">
        <OrchestratorRail channels={channels} loading={channelsLoading} error={channelsError} onRetry={retryChannels} onSelect={selectChannel} organizationKey={organizationKey} organizationOptions={organizationOptions} onOrganizationChange={onOrganizationChange} selectedScopeId={selectedScopeId} onScopeChange={onScopeChange} />
        <section className="flex min-h-0 min-w-0 flex-col bg-obsidian-990/90 [contain:layout_paint]">
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--border-faint)] px-5">
             <div className="min-w-0"><h1 className="truncate pb-0.5 font-display text-base leading-6 text-silver-50 lowercase">#{selected?.channel?.name ?? "general"}</h1>{replyParent ? <p className="truncate text-[10px] text-silver-500">Replies to {replyParent.author.type === "user" ? "You" : replyParent.author.name}</p> : null}</div>
            {replyState ? <Button type="button" variant="secondary" aria-label="Back from replies" onClick={() => void backFromReplies()} className="ml-auto min-h-0 rounded-lg px-3 py-1.5 text-[10px]">Back</Button> : selected?.canChat && channelKey ? <Button type="button" variant="secondary" disabled={Boolean(streaming[channelKey]) || clearing} onClick={() => setClearOpen(true)} className="ml-auto min-h-0 rounded-lg px-3 py-1.5 text-[10px]">Clear channel</Button> : null}
          </div>
          <div ref={messagesPane} className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2 [contain:content] [touch-action:pan-y] sm:px-6" aria-busy={channelKey ? Boolean(messagesLoading[channelKey]) : false}>
            {selected && !selected.canChat ? <div className="flex h-full items-center justify-center text-center text-[12px] text-silver-300">You lack permission to chat with {selected.orchestrator.name}.</div> : null}
            {selected?.canChat && channelKey && messagesLoading[channelKey] && !messages[channelKey] ? <div className="space-y-3 py-4">{[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-lg bg-white/[0.03]" />)}</div> : null}
               {selected?.canChat ? displayedMessages.map((message) => <MessageView key={message.key} entry={selected} message={message} organizationKey={organizationKey} userName={userName} countryCode={countryCode} mentions={mentions} onOpenActions={setActionMessage} busy={busyMessage === message.key} onBusy={(busy) => setBusyMessage(busy ? message.key : null)} onRefresh={() => replyState ? refreshReplies() : refreshMessages(channelKey!)} onOpenReplies={(target) => void openReplies(target)} onCreatePoll={(target) => { if (channelKey) setErrors((current) => ({ ...current, [channelKey]: null })); setPollMessage(target); }} onError={(error) => channelKey && setErrors((current) => ({ ...current, [channelKey]: error }))} onOptimisticReaction={optimisticallySetReaction} />) : null}
          </div>
            {channelKey && errors[channelKey] ? <p role="alert" className="shrink-0 border-t border-status-critical/30 bg-status-critical/5 px-5 py-2 text-[10px] text-status-critical">{errors[channelKey]}</p> : null}
            <div aria-live="polite" className="flex h-6 shrink-0 items-end px-5 text-[10px] font-medium"><span className={typingLabel ? "chorus-typing-gradient" : "sr-only"}>{typingLabel}</span></div>
            <MessageComposer key={`${organizationKey}:${channelKey ?? "none"}:${activeReplyParentKey ?? "channel"}`} organizationKey={organizationKey} channelKey={channelKey} orchestratorName={selected?.orchestrator.name ?? null} canChat={Boolean(selected?.canChat)} streaming={channelKey ? Boolean(streaming[channelKey]) : false} onSubmit={replyState && channelKey ? (content) => { void submitReply(content); } : submitComposerMessage} onTypingChange={publishTyping} mentions={mentions} mentionRoster={mentionRoster} channelDrafts={channelDrafts.current} draftId={activeReplyParentKey ?? "channel"} />
        </section>
        <Dialog.Root open={clearOpen} onOpenChange={(open) => { if (!clearing) setClearOpen(open); }}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-obsidian-990/70" />
            <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,390px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--border-strong)] bg-obsidian-950 p-5 shadow-2xl" aria-describedby="clear-channel-description">
              <Dialog.Title className="text-sm text-silver-50">Clear this channel?</Dialog.Title>
              <Dialog.Description id="clear-channel-description" className="mt-2 text-[11px] leading-5 text-silver-400">This removes every message in your channel with {selected?.orchestrator.name ?? "this orchestrator"}.</Dialog.Description>
               <div className="mt-5 flex justify-end gap-2"><Dialog.Close asChild><Button type="button" variant="secondary" disabled={clearing} className="min-h-0 rounded-lg px-4 py-2 text-[10px]">Cancel</Button></Dialog.Close><Button type="button" variant="primary" loading={clearing} onClick={() => void clearSelectedChannel()} className="min-h-0 rounded-lg px-4 py-2 text-[10px]">Clear channel</Button></div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        {pollMessage && channelKey ? <PollComposer message={pollMessage} busy={busyMessage === pollMessage.key} error={errors[channelKey] ?? null} onCancel={() => setPollMessage(null)} onCreate={async (question, options, allowMultiple) => {
          const requestChannel = channelKey;
          const requestOrganization = organizationKey;
          const generation = organizationGeneration.current;
          setBusyMessage(pollMessage.key);
          setErrors((current) => ({ ...current, [requestChannel]: null }));
          try {
            const poll = await createChorusPoll(requestOrganization, requestChannel, pollMessage.key, question, options, allowMultiple);
            if (organizationGeneration.current !== generation || activeChannel.current !== requestChannel) return;
            updateMessageActions(pollMessage.key, (message) => ({ ...message, poll }));
            await refreshMessages(requestChannel);
            if (organizationGeneration.current === generation && activeChannel.current === requestChannel) setPollMessage(null);
          } catch (error) {
            if (organizationGeneration.current === generation) setErrors((current) => ({ ...current, [requestChannel]: error instanceof Error ? error.message : "Poll creation or refresh failed" }));
          } finally {
            if (organizationGeneration.current === generation) setBusyMessage(null);
          }
        }} /> : null}
        <Dialog.Root open={Boolean(actionMessage)} onOpenChange={(open) => { if (!open) closeMessageActions(); }}>
          <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-obsidian-990/70" /><Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-2xl border border-[var(--border-strong)] bg-obsidian-950 p-4 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[420px] sm:max-h-none sm:rounded-none" aria-describedby={undefined}>
            <div className="flex items-center justify-between"><Dialog.Title className="text-sm text-silver-50">Message actions</Dialog.Title><Dialog.Close asChild><Button variant="icon" aria-label="Close message actions" icon={<CloseIcon size="sm" />} className="h-8 min-h-0 w-8">Close message actions</Button></Dialog.Close></div>
             <div className="mt-4 grid gap-2"><Button type="button" variant="secondary" onClick={() => { if (!actionMessage) return; const message = actionMessage; closeMessageActions(); void openReplies(message); }} className="min-h-0 justify-start rounded-lg px-3 py-2 text-left text-xs normal-case tracking-normal">Replies</Button><Button type="button" variant="secondary" onClick={() => { if (channelKey) setErrors((current) => ({ ...current, [channelKey]: null })); setPollMessage(actionMessage); closeMessageActions(); }} className="min-h-0 justify-start rounded-lg px-3 py-2 text-left text-xs normal-case tracking-normal">Poll</Button><Button type="button" variant="secondary" onClick={() => { stopMessageSpeech(); setReactionPickerOpen(true); }} className="min-h-0 justify-start rounded-lg px-3 py-2 text-left text-xs normal-case tracking-normal">React</Button><Button type="button" variant="secondary" disabled={!actionMessage?.content || busyMessage === actionMessage?.key} onClick={() => void toggleMessageSpeech()} className="min-h-0 justify-start rounded-lg px-3 py-2 text-left text-xs normal-case tracking-normal">{actionMessage && speechAudio.current.get(actionMessage.key) && (voicePlayingSrc === speechAudio.current.get(actionMessage.key) || pendingVoiceSrc === speechAudio.current.get(actionMessage.key)) ? "Stop listening" : "Listen"}</Button></div>
             <div className="mt-auto flex justify-between gap-2 border-t border-[var(--border-faint)] pt-4"><Button type="button" variant="danger" onClick={() => void deleteSelectedMessage()} className="min-h-0 rounded-lg px-4 py-2 text-[10px]">Delete</Button><Dialog.Close asChild><Button variant="secondary" className="min-h-0 rounded-lg px-4 py-2 text-[10px]">Close</Button></Dialog.Close></div>
          </Dialog.Content></Dialog.Portal>
        </Dialog.Root>
        <Dialog.Root open={reactionPickerOpen} onOpenChange={(open) => { setReactionPickerOpen(open); if (!open) { setReactionQuery(""); setActionMessage(null); } }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-obsidian-990/70" /><Dialog.Content className="fixed inset-x-0 bottom-0 z-[60] flex h-[min(88vh,680px)] max-h-[88vh] flex-col rounded-t-2xl border border-[var(--border-strong)] bg-obsidian-950 p-4 sm:inset-y-0 sm:right-0 sm:left-auto sm:h-auto sm:w-[420px] sm:max-h-none sm:rounded-none" aria-describedby={undefined}><div className="flex items-center justify-between"><Dialog.Title className="text-sm text-silver-50">Reactions</Dialog.Title><Dialog.Close asChild><Button variant="icon" aria-label="Close reactions" icon={<CloseIcon size="sm" />} className="h-8 min-h-0 w-8">Close reactions</Button></Dialog.Close></div><SearchInput autoFocus value={reactionQuery} onChange={(event) => setReactionQuery(event.target.value)} placeholder="Search..." aria-label="Search reactions" className="mt-4 w-full" />{frequentReactions.length ? <div aria-label="Frequently used reactions" className="mt-2 flex flex-wrap gap-2">{frequentReactions.map(({ reaction, count }) => <Button key={reaction} type="button" size="sm" variant="outline" aria-label={`React with ${reaction}, used ${count} times`} onClick={() => void selectReaction(reaction)} className="px-3 text-base normal-case tracking-normal">{reaction}</Button>)}</div> : null}<div ref={emojiPicker} className="chorus-reaction-picker mt-1 min-h-0 flex-1 overflow-hidden rounded-xl [&_.epr-search-container]:!hidden"><EmojiPicker theme={"dark" as Theme} emojiStyle={"native" as EmojiStyle} width="100%" height="100%" lazyLoadEmojis autoFocusSearch={false} searchPlaceholder="Search..." skinTonesDisabled previewConfig={{ showPreview: false }} onEmojiClick={({ emoji }) => { void selectReaction(emoji); }} /></div><div className="mt-5 flex justify-end border-t border-[var(--border-faint)] pt-4"><Dialog.Close asChild><Button variant="secondary" className="min-h-0 rounded-lg px-4 py-2 text-[10px]">Close</Button></Dialog.Close></div></Dialog.Content></Dialog.Portal></Dialog.Root>
      </div>
    </div>
  );
}
