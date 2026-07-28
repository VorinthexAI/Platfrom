"use client";

import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { memo, useCallback, useDeferredValue, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, MicrophoneIcon, MoreHorizontalIcon, SendIcon, SoundwaveIcon } from "@vorinthex/shared/ui/icons";
import { Button } from "@vorinthex/shared/ui";
import { useAudioStore } from "@/lib/audio/audio-store";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { entityLogoThumbnailUrl } from "@/lib/three/entity-logo";
import {
  closeChorusPoll,
  buildChorusMentionRows,
  CHORUS_ORCHESTRATOR_NAMES,
  clearChorusChannel,
  coalesceChorusStreamEvents,
  createChorusPoll,
  createChorusThread,
  deleteChorusMessage,
  listChorusChannels,
  listChorusMessages,
  listChorusThreads,
  markChorusStreamFailed,
  mergeChorusMessageRefresh,
  mutateChorusReaction,
  readChorusThread,
  replyChorusThread,
  plainChorusText,
  reconcileChorusStreamEvent,
  streamChorusMessage,
  synthesizeChorusSpeech,
  transcribeChorusAudio,
  voteChorusPoll,
  type ChorusChannelEntry,
  type ChorusDisplayMessage,
  type ChorusMessage,
  type ChorusMention,
  type ChorusMentionRoster,
  type ChorusThread,
  type ChorusThreadListItem,
  type ChorusStreamEvent,
} from "@/lib/founders/chorus";
import { createFrameBatcher } from "@/lib/founders/frame-batcher";
import { filterChorusReactions } from "@/lib/founders/chorus-reactions";
import { appendSpokenTranscript, startPcmCapture, type PcmCapture } from "@/lib/founders/chorus-microphone";

interface HqCommunicationOverlayProps {
  organizationKey: string;
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
  const label = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone, timeZoneName: "short" }).format(new Date(value));
  return <time dateTime={value} title={value} className="font-mono text-[9px] text-silver-600">{label}</time>;
}

function ScopeMark({ entity, size = 28 }: { entity: GalaxyEntity; size?: number }) {
  return <span className="relative inline-flex shrink-0 overflow-hidden rounded-full border border-[var(--border-faint)] bg-obsidian-990/80" style={{ width: size, height: size }}><Image src={entityLogoThumbnailUrl(entity.type, entity.slug)} alt="" fill sizes={`${size}px`} unoptimized className="object-contain p-[2px] opacity-90" /></span>;
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
    <button ref={triggerRef} type="button" onClick={() => { if (pickerOpen) closePicker(); else { setQuery(""); setActiveIndex(selectedIndex); setPickerOpen(true); } }} aria-expanded={pickerOpen} aria-haspopup="listbox" className="flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-[var(--border-faint)] bg-[var(--panel)] px-2.5 text-left transition-colors hover:border-[var(--border-strong)]">
      <span className="flex min-w-0 items-center gap-2"><ScopeMark entity={selectedScope} /><span className="truncate text-[13px] text-silver-100">{selectedScope.name}</span></span>
      {pickerOpen ? <ChevronUpIcon aria-hidden size="sm" className="shrink-0 text-silver-500" /> : <ChevronDownIcon aria-hidden size="sm" className="shrink-0 text-silver-500" />}
    </button>
    {pickerOpen ? <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-30 rounded-2xl border border-[var(--border-strong)] bg-obsidian-990/95 p-2 shadow-2xl backdrop-blur-2xl">
      <div className="relative mb-2"><input ref={inputRef} autoFocus role="combobox" aria-expanded="true" aria-controls="hq-scope-options" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={handlePickerKeyDown} placeholder="Search scopes..." className="w-full rounded-xl border border-[var(--border-faint)] bg-white/[0.04] py-2 pr-9 pl-3 font-mono text-[10px] text-silver-100 outline-none placeholder:text-silver-600 focus:border-[var(--border-strong)]" />
        {query ? <Button type="button" variant="icon" aria-label="Clear scope search" onClick={() => { setQuery(""); setActiveIndex(0); inputRef.current?.focus(); }} icon={<CloseIcon size="sm" />} className="absolute top-1/2 right-2 h-6 min-h-0 w-6 -translate-y-1/2 text-silver-500">Clear scope search</Button> : null}
      </div>
      <div id="hq-scope-options" role="listbox" className="scrollbar-hide max-h-64 overflow-y-auto overscroll-contain [touch-action:pan-y]">
        {filteredScopes.length ? filteredScopes.map((scope, index) => <button key={scope.id} type="button" role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => selectFilteredScope(index)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] transition-colors ${index === activeIndex ? "bg-white/[0.07] text-white" : "text-silver-400 hover:bg-white/[0.07] hover:text-white"}`}><ScopeMark entity={scope} size={22} /><span className="truncate">{scope.name}</span></button>) : <p className="px-2.5 py-3 text-[11px] text-silver-500">No scopes found.</p>}
      </div>
    </div> : null}
  </div>;
}

interface RailProps {
  channels: ChorusChannelEntry[];
  selectedKey: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (entry: ChorusChannelEntry) => void;
  selectedScopeId: string;
  onScopeChange: (id: string) => void;
}

const OrchestratorRail = memo(function OrchestratorRail({ channels, selectedKey, loading, error, onRetry, onSelect, selectedScopeId, onScopeChange }: RailProps) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-[var(--border-faint)] bg-obsidian-950/90 [contain:layout_paint]">
      <div className="border-b border-[var(--border-faint)] p-4"><span className="mb-2 block font-mono text-[9px] uppercase tracking-[0.2em] text-silver-500">Scope</span><ScopeSelector selectedScopeId={selectedScopeId} onScopeChange={onScopeChange} /></div>
      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [contain:content]">
        {loading ? <div aria-label="Loading channels" className="space-y-2">{[0, 1, 2, 3].map((item) => <div key={item} className="h-10 animate-pulse rounded-lg bg-white/[0.04]" />)}</div> : null}
        {error ? <div role="alert" className="rounded-xl border border-status-critical/30 p-3 text-[11px] text-status-critical"><p>{error}</p><Button type="button" variant="secondary" onClick={onRetry} className="mt-2 min-h-0 rounded-md px-3 py-1.5 text-[9px]">Retry</Button></div> : null}
        {!loading && !error && channels.length === 0 ? <p className="p-2 text-[11px] text-silver-500">No channels are available.</p> : null}
        <div className="space-y-1">
          {channels.map((entry) => {
            const selected = entry.orchestrator.key === selectedKey;
            return (
              <button key={entry.orchestrator.key} type="button" aria-current={selected ? "page" : undefined} aria-label={`${entry.orchestrator.name}${entry.canChat ? "" : ", chat unavailable"}`} onClick={() => onSelect(entry)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-silver-300 ${selected ? "bg-[var(--panel-strong)] text-silver-50" : "text-silver-300 hover:bg-white/[0.04]"} ${entry.canChat ? "" : "opacity-55"}`}>
                <span aria-hidden className="font-mono text-[12px] text-silver-500">#</span><span className="min-w-0 flex-1 truncate text-[12px] lowercase">{entry.channel?.name}</span>
                {!entry.canChat ? <span aria-hidden title="Chat unavailable" className="text-[10px]">LOCK</span> : null}
              </button>
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
          <button key={option.key} type="button" disabled={busy || poll.status === "closed"} aria-pressed={option.viewerVoted} onClick={() => void mutate(() => voteChorusPoll(organizationKey, channelKey, poll.key, option.key))} className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-[10px] focus-visible:outline-2 disabled:cursor-not-allowed ${option.viewerVoted ? "border-silver-400 bg-white/[0.08] text-silver-50" : "border-[var(--border-faint)] text-silver-300"}`}>
            <span>{option.text}</span><span>{option.voteCount}</span>
          </button>
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
  onOpenThread: (message: ChorusMessage) => void;
  onCreatePoll: (message: ChorusMessage) => void;
  onError: (error: string | null) => void;
  onOptimisticReaction: (messageKey: string, reaction: string) => void;
  userName: string;
  countryCode: string;
  mentions: ChorusMention[];
  onOpenActions: (message: ChorusMessage) => void;
}

function MessageContent({ content, mentions }: { content: string; mentions: ChorusMention[] }) {
  const names = new Set(mentions.map((mention) => mention.name.toLocaleLowerCase()));
  return <>{plainChorusText(content).split(/(@[a-z0-9_-]+)/gi).map((part, index) => names.has(part.slice(1).toLocaleLowerCase()) ? <strong key={index} className="font-semibold text-silver-50">{part}</strong> : part)}</>;
}

function toggleOptimisticReaction(messages: ChorusMessage[], messageKey: string, reaction: string): ChorusMessage[] {
  return messages.map((message) => {
    if (message.key !== messageKey) return message;
    const existing = message.reactions.find((item) => item.reaction === reaction);
    const reactions = existing
      ? message.reactions.map((item) => item.reaction === reaction ? { ...item, count: item.count + (item.viewerReacted ? -1 : 1), viewerReacted: !item.viewerReacted } : item).filter((item) => item.count > 0)
      : [...message.reactions, { reaction, count: 1, viewerReacted: true }];
    return { ...message, reactions };
  });
}

const MessageView = memo(function MessageView({ entry, message, organizationKey, busy, onBusy, onRefresh, onOpenThread, onCreatePoll, onError, onOptimisticReaction, userName, countryCode, mentions, onOpenActions }: MessageViewProps) {
  const channelKey = entry.channel!.key;
  const interactive = !message.clientState;
  const react = async (reaction: string) => {
    if (busy) return;
    onBusy(true); onError(null); onOptimisticReaction(message.key, reaction);
    try { await mutateChorusReaction(organizationKey, channelKey, message.key, reaction); }
    catch (error) { onOptimisticReaction(message.key, reaction); onError(error instanceof Error ? error.message : "Reaction failed"); }
    finally { await onRefresh().catch(() => {}); onBusy(false); }
  };
  return (
    <article onContextMenu={(event) => { event.preventDefault(); onOpenActions(message); }} className="group relative flex gap-3 px-1 py-3 [content-visibility:auto] [contain-intrinsic-size:auto_84px]">
      {message.author.type === "orchestrator" ? <OrchestratorMark name={message.author.name} size={36} /> : <span aria-label={userName} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-soft)] bg-obsidian-850 font-mono text-[11px] text-silver-200">{userName.trim().charAt(0).toUpperCase() || "?"}</span>}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2"><h3 className="text-[12px] font-medium text-silver-50">{message.author.type === "user" ? "You" : message.author.name}</h3><Timestamp value={message.createdAt} countryCode={countryCode} /></div>
        <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-silver-300">{message.content ? <MessageContent content={message.content} mentions={mentions} /> : message.clientState?.state === "failed" ? <span className="text-status-critical">No response was received.</span> : <span className="animate-pulse text-silver-500">Thinking...</span>}</p>
        {message.clientState ? <p role={message.clientState.state === "failed" ? "alert" : "status"} className={`mt-1 font-mono text-[8px] uppercase ${message.clientState.state === "failed" ? "text-status-critical" : "text-silver-600"}`}>{message.clientState.state === "failed" ? message.clientState.error ?? "Message reconciliation failed" : message.author.type === "user" ? "Sending" : "Response pending"}</p> : null}
        {MESSAGE_ACTIONS_ENABLED && interactive ? <PollView organizationKey={organizationKey} channelKey={channelKey} message={message} busy={busy} onBusy={onBusy} onRefresh={onRefresh} onError={onError} /> : null}
        {MESSAGE_ACTIONS_ENABLED && interactive ? <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {message.reactions.map((aggregate) => <button key={aggregate.reaction} type="button" disabled={busy} aria-label={`${aggregate.viewerReacted ? "Remove" : "Add"} ${aggregate.reaction} reaction`} aria-pressed={aggregate.viewerReacted} onClick={() => void react(aggregate.reaction)} className={`rounded-full border px-2 py-0.5 font-mono text-[8px] focus-visible:outline-2 disabled:opacity-40 ${aggregate.viewerReacted ? "border-silver-400 bg-white/[0.08] text-silver-100" : "border-[var(--border-faint)] text-silver-500"}`}>{aggregate.reaction} {aggregate.count}</button>)}
          {message.thread && message.thread.replyCount > 0 ? <button type="button" onClick={() => onOpenThread(message)} className="rounded-md border border-[var(--border-soft)] px-2 py-0.5 text-[9px] text-silver-300">{message.thread.replyCount} thread{message.thread.replyCount === 1 ? "" : "s"}</button> : null}
          {message.poll ? <button type="button" onClick={() => onCreatePoll(message)} className="rounded-md border border-[var(--border-soft)] px-2 py-0.5 text-[9px] text-silver-300">1 poll</button> : null}
        </div> : null}
      </div>
      {MESSAGE_ACTIONS_ENABLED && interactive ? <Button type="button" variant="icon" onClick={() => onOpenActions(message)} icon={<MoreHorizontalIcon size="sm" />} className="pointer-events-none absolute top-3 right-1 h-8 min-h-0 w-9 rounded-lg border-[var(--border-soft)] opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100">Message actions</Button> : null}
    </article>
  );
}, (previous, next) => previous.entry === next.entry
  && previous.message === next.message
  && previous.organizationKey === next.organizationKey
  && previous.busy === next.busy);

function PollComposer({ message, onCancel, onCreate, busy, error }: { message: ChorusMessage; onCancel: () => void; onCreate: (question: string, options: string[], allowMultiple: boolean) => Promise<void>; busy: boolean; error: string | null }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const validOptions = options.map((option) => option.trim()).filter(Boolean);
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-obsidian-990/65" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-2xl border border-[var(--border-strong)] bg-obsidian-950 p-5 shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[420px] sm:max-h-none sm:rounded-none" aria-describedby={undefined}>
    <form onSubmit={(event) => { event.preventDefault(); void onCreate(question.trim(), validOptions, allowMultiple); }} aria-label={`Create poll for message: ${message.content.slice(0, 40)}`} className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-between"><Dialog.Title className="text-xs text-silver-100">Create poll</Dialog.Title><Dialog.Close asChild><Button variant="icon" disabled={busy} aria-label="Cancel poll creation" icon={<CloseIcon size="sm" />} className="h-8 min-h-0 w-8">Cancel poll creation</Button></Dialog.Close></div>
       <input autoFocus value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} placeholder="Question" aria-label="Poll question" className="mt-5 w-full rounded-md border border-[var(--border-faint)] bg-white/[0.04] px-3 py-2 text-[11px] text-white outline-none focus:border-silver-500" />
       <div className="mt-3 space-y-3">{options.map((option, index) => <input key={index} value={option} onChange={(event) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} maxLength={200} placeholder={`Option ${index + 1}`} aria-label={`Poll option ${index + 1}`} className="w-full rounded-md border border-[var(--border-faint)] bg-white/[0.04] px-3 py-2 text-[11px] text-white outline-none focus:border-silver-500" />)}</div>
       <div className="mt-4 flex items-center justify-between"><label className="flex items-center gap-2 text-[10px] text-silver-400"><input type="checkbox" checked={allowMultiple} onChange={(event) => setAllowMultiple(event.target.checked)} />Multiple choices</label>{options.length < 10 ? <Button type="button" variant="ghost" onClick={() => setOptions((current) => [...current, ""])} className="text-[10px] normal-case tracking-normal">Add option</Button> : null}</div>
      {error ? <p role="alert" className="mt-2 text-[10px] text-status-critical">{error}</p> : null}
       <div className="mt-auto border-t border-[var(--border-faint)] pt-4"><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onCancel} className="min-h-0 px-4 py-2 text-[10px]">Close</Button><Button type="submit" variant="primary" disabled={busy || !question.trim() || validOptions.length < 2 || new Set(validOptions.map((option) => option.toLowerCase())).size !== validOptions.length} className="min-h-0 px-4 py-2 text-[10px]">Create poll</Button></div></div>
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
  error: string | null;
  onSubmit: (content: string) => void;
  mentions: ChorusMention[];
  mentionRoster: ChorusMentionRoster | null;
  channelDrafts: Map<string, string>;
  draftId: string;
}

const MessageComposer = memo(function MessageComposer({ organizationKey, channelKey, orchestratorName, canChat, streaming, error, onSubmit, mentions, mentionRoster, channelDrafts, draftId }: MessageComposerProps) {
  const draftKey = channelKey ? `${organizationKey}:${channelKey}:${draftId}` : null;
  const [draft, setDraft] = useState(() => draftKey ? channelDrafts.get(draftKey) ?? "" : "");
  const [recording, setRecording] = useState(false);
  const [startingRecording, setStartingRecording] = useState(false);
  const [speechLevel, setSpeechLevel] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const capture = useRef<PcmCapture | null>(null);
  const captureGeneration = useRef(0);
  const transcription = useRef<AbortController | null>(null);
  const query = /(?:^|\s)@([\w-]*)$/.exec(draft)?.[1] ?? "";
  const rosterRows = mentionRoster ? buildChorusMentionRows(mentionRoster) : { orchestrators: [], people: [] };
  const serverOrchestrators = new Map(rosterRows.orchestrators.map((mention) => [mention.name, mention]));
  const orchestrators: ChorusMention[] = CHORUS_ORCHESTRATOR_NAMES.map((name) => serverOrchestrators.get(name) ?? { participantKey: `canonical-${name.toLowerCase()}`, type: "orchestrator", key: `canonical-${name.toLowerCase()}`, name, role: "Orchestrator", mentionCount: 0 });
  const people = rosterRows.people;
  const ordered = [...orchestrators, ...people];
  const visible = ordered.filter((mention) => !query || mention.name.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()));
  useEffect(() => () => { captureGeneration.current += 1; capture.current?.cancel(); transcription.current?.abort(); }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !channelKey || !canChat || streaming || recording || startingRecording || transcribing) return;
    channelDrafts.set(draftKey!, "");
    setDraft("");
    onSubmit(content);
  };

  const insertMention = (name: string) => {
    const next = /@([\w-]*)$/.test(draft) ? draft.replace(/@([\w-]*)$/, `@${name} `) : `${draft}${draft && !/\s$/.test(draft) ? " " : ""}@${name} `;
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
      <form onSubmit={submit} className="rounded-xl border border-[var(--border-soft)] bg-obsidian-900/90 p-3 focus-within:border-[var(--border-strong)]">
        <textarea
          value={draft}
          onChange={(event) => {
            const value = event.target.value;
            setDraft(value);
            if (draftKey) channelDrafts.set(draftKey, value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Tab" && visible[0]) {
              event.preventDefault();
              insertMention(visible[0].name);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          disabled={!canChat || !channelKey}
          rows={2}
          maxLength={8000}
          placeholder={placeholder}
          aria-label={orchestratorName ? `Message ${orchestratorName}` : "Message"}
          className="block w-full resize-none bg-transparent text-[12px] text-silver-100 outline-none placeholder:text-silver-500 disabled:cursor-not-allowed"
        />
        <div className="mt-2 flex min-h-8 items-center justify-between gap-3">
          <span role="status" className={`text-[10px] ${error ? "text-status-critical" : "text-silver-600"}`}>
            {voiceError ? voiceError : error ? error : transcribing ? "Realtime 2 is transcribing..." : recording ? "Listening... tap the microphone to finish" : streaming ? `${orchestratorName} is responding...` : !canChat && orchestratorName ? `You lack permission to chat with ${orchestratorName}.` : null}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="icon" onClick={() => void toggleRecording()} disabled={!canChat || !channelKey || transcribing || startingRecording} aria-label={recording ? "Stop speaking and transcribe" : "Speak into message"} aria-pressed={recording} icon={<MicrophoneIcon size="sm" className={recording && speechLevel > 0.015 ? "scale-110" : undefined} />} className={`h-11 min-h-11 w-11 rounded-lg ${recording ? "border-silver-200 bg-white/[0.1] text-silver-50" : "text-silver-400"}`}>{recording ? "Stop speaking and transcribe" : "Speak into message"}</Button>
            <Button type="submit" variant="primary" disabled={!canChat || !channelKey || streaming || recording || startingRecording || transcribing || !draft.trim()} aria-label={orchestratorName ? `Send message to ${orchestratorName}` : "Send message"} icon={<SendIcon aria-hidden size="sm" strokeWidth={1.9} />} className="h-11 min-h-11 w-11 rounded-lg p-0 disabled:opacity-80" />
          </div>
        </div>
      </form>
      <div aria-label="Mention shortcuts" className="mt-2 flex w-full min-w-0 flex-nowrap gap-1.5 overflow-x-auto overscroll-x-contain pb-1">
        {people.map((mention) => <button key={`${mention.type}:${mention.key}`} type="button" onClick={() => insertMention(mention.name)} className="shrink-0 rounded-md border border-[var(--border-soft)] px-2 py-1 font-mono text-[10px] text-silver-200 hover:border-silver-500">@{mention.name === "everyone" ? "everyone" : mention.name}</button>)}
        {orchestrators.map((mention) => <button key={`orchestrator:${mention.key}`} type="button" onClick={() => insertMention(mention.name)} className="shrink-0 rounded-md bg-[image:var(--gradient-chrome)] px-1.5 py-1 font-mono text-[9px] text-obsidian-990">@{mention.name.toLowerCase()}</button>)}
      </div>
    </div>
  );
});

export default function HqCommunicationOverlay({ organizationKey, userName, countryCode, selectedScopeId, onScopeChange }: HqCommunicationOverlayProps) {
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
  const deferredReactionQuery = useDeferredValue(reactionQuery);
  const filteredReactions = filterChorusReactions(deferredReactionQuery);
  const [threadState, setThreadState] = useState<{ thread: ChorusThread; messages: ChorusMessage[]; loading: boolean; error: string | null } | null>(null);
  const [threadSheetOpen, setThreadSheetOpen] = useState(false);
  const [threadItems, setThreadItems] = useState<ChorusThreadListItem[]>([]);
  const [threadRoot, setThreadRoot] = useState<ChorusMessage | null>(null);
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const messageRequests = useRef(new Map<string, number>());
  const organizationGeneration = useRef(0);
  const threadGeneration = useRef(0);
  const currentOrganization = useRef(organizationKey);
  const activeChannel = useRef<string | null>(null);
  const messagesPane = useRef<HTMLDivElement>(null);
  const shouldFollowMessages = useRef(true);
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
    threadGeneration.current += 1;
    for (const active of controllers.current.values()) active.abort();
    controllers.current.clear();
    messageRequests.current.clear();
    activeChannel.current = null;
    setChannels([]); setMentions([]); setMentionRoster(null); setMessages({}); setMessagesLoading({}); setStreaming({}); setErrors({}); setSelectedKey(null); setThreadState(null); setPollMessage(null); setBusyMessage(null); setClearOpen(false);
    setChannelsLoading(true); setChannelsError(null);
    const controller = new AbortController();
    controllers.current.get("channels")?.abort(); controllers.current.set("channels", controller);
    try {
      const loaded = await listChorusChannels(organizationKey, controller.signal);
      if (controller.signal.aborted || organizationGeneration.current !== generation || currentOrganization.current !== organizationKey) return;
      setChannels(loaded.channels); setMentions(loaded.mentions); setMentionRoster(loaded.mentionRoster);
      setSelectedKey((current) => loaded.channels.some((entry) => entry.orchestrator.key === current) ? current : loaded.channels[0]?.orchestrator.key ?? null);
    } catch (error) { if (!controller.signal.aborted && organizationGeneration.current === generation) setChannelsError(error instanceof Error ? error.message : "Channels could not load"); }
    finally { if (!controller.signal.aborted && organizationGeneration.current === generation) setChannelsLoading(false); }
  }, [organizationKey]);

  const refreshMessages = useCallback(async (channelKey: string, preserveTransient = true) => {
    const generation = organizationGeneration.current;
    const requestOrganization = organizationKey;
    const requestId = (messageRequests.current.get(channelKey) ?? 0) + 1;
    messageRequests.current.set(channelKey, requestId);
    setMessagesLoading((current) => ({ ...current, [channelKey]: true }));
    const controller = new AbortController();
    controllers.current.get(`messages:${channelKey}`)?.abort(); controllers.current.set(`messages:${channelKey}`, controller);
    try {
      const loaded = await listChorusMessages(organizationKey, channelKey, controller.signal);
      if (!controller.signal.aborted && organizationGeneration.current === generation && currentOrganization.current === requestOrganization && messageRequests.current.get(channelKey) === requestId) {
        setMessages((current) => ({ ...current, [channelKey]: mergeChorusMessageRefresh(current[channelKey] ?? [], loaded, preserveTransient) }));
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
  useEffect(() => () => { for (const controller of controllers.current.values()) controller.abort(); }, []);

  const selected = channels.find((entry) => entry.orchestrator.key === selectedKey) ?? null;
  const channelKey = selected?.channel?.key ?? null;
  const selectedMessages = channelKey ? messages[channelKey] : undefined;
  activeChannel.current = channelKey;
  useEffect(() => { if (selected?.canChat && channelKey) void refreshMessages(channelKey).catch(() => {}); }, [selectedKey, channelKey, selected?.canChat, refreshMessages]);
  useEffect(() => {
    shouldFollowMessages.current = true;
    const frame = requestAnimationFrame(() => {
      const pane = messagesPane.current;
      if (pane) pane.scrollTop = pane.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [channelKey]);
  useEffect(() => {
    if (!shouldFollowMessages.current) return;
    const frame = requestAnimationFrame(() => {
      const pane = messagesPane.current;
      if (pane && shouldFollowMessages.current) pane.scrollTop = pane.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedMessages]);
  useEffect(() => () => { speechRequest.current?.abort(); stopVoice(); for (const url of speechAudio.current.values()) URL.revokeObjectURL(url); speechAudio.current.clear(); }, [organizationKey, channelKey, stopVoice]);

  const selectChannel = useCallback((entry: ChorusChannelEntry) => {
    threadGeneration.current += 1;
    controllers.current.get("thread")?.abort();
    activeChannel.current = entry.channel?.key ?? null;
    setSelectedKey(entry.orchestrator.key); setPollMessage(null); setThreadState(null); setClearOpen(false);
    if (entry.orchestrator.key === selectedKey && entry.canChat && entry.channel) void refreshMessages(entry.channel.key).catch(() => {});
  }, [refreshMessages, selectedKey]);
  const retryChannels = useCallback(() => { void loadChannels(); }, [loadChannels]);

  const submitMessage = useCallback(async (content: string) => {
    if (!selected?.canChat || !channelKey || streaming[channelKey] || !content) return;
    shouldFollowMessages.current = true;
    const now = new Date().toISOString();
    const userKey = `optimistic-user-${crypto.randomUUID()}`;
    const assistantKey = `optimistic-assistant-${crypto.randomUUID()}`;
    const streamKey = crypto.randomUUID();
    const stream = { streamKey, userKey, assistantKey };
    const generation = organizationGeneration.current;
    const user: ChorusDisplayMessage = { key: userKey, channelKey, content, createdAt: now, updatedAt: now, author: { participantKey: "optimistic", type: "user", key: "optimistic", name: "You" }, reactions: [], thread: null, poll: null, clientState: { streamKey, state: "optimistic" } };
    const assistant: ChorusDisplayMessage = { key: assistantKey, channelKey, content: "", createdAt: now, updatedAt: now, author: { participantKey: "optimistic", type: "orchestrator", key: selected.orchestrator.key, name: selected.orchestrator.name }, reactions: [], thread: null, poll: null, clientState: { streamKey, state: "pending" } };
    setMessages((current) => ({ ...current, [channelKey]: [...(current[channelKey] ?? []), user, assistant] }));
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
        eventBatcher.push(streamEvent);
        if (streamEvent.type === "done") eventBatcher.flush();
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
        setErrors((current) => ({ ...current, [channelKey]: message }));
        setMessages((current) => ({ ...current, [channelKey]: markChorusStreamFailed(current[channelKey] ?? [], streamKey, message) }));
      }
    } finally {
      eventBatcher.cancel();
      controllers.current.delete(`stream:${channelKey}`);
      if (organizationGeneration.current === generation) setStreaming((current) => ({ ...current, [channelKey]: false }));
    }
  }, [channelKey, organizationKey, refreshMessages, selected, streaming]);
  const submitComposerMessage = useCallback((content: string) => { void submitMessage(content); }, [submitMessage]);

  const openThread = async (message: ChorusMessage, requestedThreadKey = message.thread?.key) => {
    if (!channelKey || !requestedThreadKey) return;
    const generation = ++threadGeneration.current;
    const requestOrganization = organizationKey;
    const controller = new AbortController();
    controllers.current.get("thread")?.abort(); controllers.current.set("thread", controller);
    setErrors((current) => ({ ...current, [channelKey]: null }));
    try {
      const thread = { key: requestedThreadKey };
      const placeholder = { key: thread.key, channelKey, title: "Thread", rootMessageKey: message.key, status: message.thread?.status ?? "open", createdAt: message.createdAt, updatedAt: message.updatedAt } as ChorusThread;
      if (controller.signal.aborted || threadGeneration.current !== generation || activeChannel.current !== channelKey || currentOrganization.current !== requestOrganization) return;
      setThreadState({ thread: placeholder, messages: [message], loading: true, error: null });
      const loaded = await readChorusThread(organizationKey, channelKey, thread.key, controller.signal);
      if (!controller.signal.aborted && threadGeneration.current === generation && activeChannel.current === channelKey && currentOrganization.current === requestOrganization) setThreadState({ ...loaded, loading: false, error: null });
      await refreshMessages(channelKey).catch(() => {});
    } catch (error) { if (!controller.signal.aborted && threadGeneration.current === generation) setErrors((current) => ({ ...current, [channelKey]: error instanceof Error ? error.message : "Thread could not open" })); }
  };

  const openThreadSheet = async (message: ChorusMessage) => {
    if (!channelKey) return;
    speechRequest.current?.abort(); stopVoice();
    setThreadRoot(message); setNewThreadOpen(false); setNewThreadTitle(""); setThreadSheetOpen(true); setActionMessage(null);
    setThreadItems(await listChorusThreads(organizationKey, channelKey).catch(() => []));
  };

  const refreshThread = async () => {
    if (!channelKey || !threadState) return;
    const generation = threadGeneration.current;
    const threadKey = threadState.thread.key;
    const requestOrganization = organizationKey;
    const controller = new AbortController();
    controllers.current.get("thread-refresh")?.abort(); controllers.current.set("thread-refresh", controller);
    try {
      const loaded = await readChorusThread(organizationKey, channelKey, threadKey, controller.signal);
      if (!controller.signal.aborted && threadGeneration.current === generation && activeChannel.current === channelKey && currentOrganization.current === requestOrganization) setThreadState({ ...loaded, loading: false, error: null });
    } catch (error) {
      if (!controller.signal.aborted && threadGeneration.current === generation) setThreadState((current) => current?.thread.key === threadKey ? { ...current, error: error instanceof Error ? error.message : "Thread refresh failed" } : current);
      throw error;
    }
  };

  const visibleMessages = (selectedMessages ?? []).filter((message) => !message.threadKey);
  const displayedMessages = threadState?.messages ?? visibleMessages;
  const optimisticallyToggleReaction = (messageKey: string, reaction: string) => {
    if (channelKey) setMessages((current) => ({ ...current, [channelKey]: toggleOptimisticReaction(current[channelKey] ?? [], messageKey, reaction) }));
    setThreadState((current) => current ? { ...current, messages: toggleOptimisticReaction(current.messages, messageKey, reaction) } : current);
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
  return (
    <div data-scope-id={selectedScopeId} className="pointer-events-auto absolute inset-0 z-10 flex min-h-0 flex-col p-1.5 sm:p-2.5">
      <header className="flex h-12 shrink-0 items-center border border-[var(--border-faint)] bg-obsidian-990/90 px-3 sm:h-14 sm:px-4">
        <Image src="/logos/vorinthex-mark.png" alt="Vorinthex" width={23} height={23} className="opacity-90" />
        <div className="ml-3 min-w-0 flex-1 font-mono text-[9px] uppercase tracking-[0.13em] text-silver-500"><span className="text-silver-300">HQ</span><span className="mx-2">/</span><span className="truncate lowercase">#{selected?.channel?.name ?? "general"}</span></div>
      </header>
      <div className="relative grid min-h-0 flex-1 grid-rows-[minmax(150px,30vh)_minmax(0,1fr)] overflow-hidden border-x border-b border-[var(--border-faint)] md:grid-cols-[248px_minmax(0,1fr)] md:grid-rows-1">
        <OrchestratorRail channels={channels} selectedKey={selectedKey} loading={channelsLoading} error={channelsError} onRetry={retryChannels} onSelect={selectChannel} selectedScopeId={selectedScopeId} onScopeChange={onScopeChange} />
        <section className="flex min-h-0 min-w-0 flex-col bg-obsidian-990/90 [contain:layout_paint]">
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--border-faint)] px-5">
            {threadState ? <Button type="button" variant="secondary" aria-label="Back to channel" onClick={() => setThreadState(null)} className="min-h-0 rounded-lg px-3 py-1.5 text-[10px]">Back</Button> : null}
            <div className="min-w-0"><h1 className="truncate font-display text-base text-silver-50 lowercase">#{selected?.channel?.name ?? "general"}</h1>{threadState ? <p className="truncate text-[10px] text-silver-500">{threadState.thread.title}</p> : null}</div>
            {selected?.canChat && channelKey ? <Button type="button" variant="secondary" disabled={Boolean(streaming[channelKey]) || clearing} onClick={() => setClearOpen(true)} className="ml-auto min-h-0 rounded-lg px-3 py-1.5 text-[10px]">Clear channel</Button> : null}
          </div>
          <div ref={messagesPane} onWheel={(event) => { if (event.deltaY < 0) shouldFollowMessages.current = false; }} onScroll={(event) => { const pane = event.currentTarget; shouldFollowMessages.current = Math.max(0, pane.scrollHeight - pane.scrollTop - pane.clientHeight) < 24; }} className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2 [contain:content] [touch-action:pan-y] sm:px-6" aria-busy={channelKey ? Boolean(messagesLoading[channelKey]) : false}>
            {selected && !selected.canChat ? <div className="flex h-full items-center justify-center text-center text-[12px] text-silver-300">You lack permission to chat with {selected.orchestrator.name}.</div> : null}
            {selected?.canChat && channelKey && messagesLoading[channelKey] && !messages[channelKey] ? <div className="space-y-3 py-4">{[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-lg bg-white/[0.03]" />)}</div> : null}
               {selected?.canChat ? displayedMessages.map((message) => <MessageView key={message.key} entry={selected} message={message} organizationKey={organizationKey} userName={userName} countryCode={countryCode} mentions={mentions} onOpenActions={setActionMessage} busy={busyMessage === message.key} onBusy={(busy) => setBusyMessage(busy ? message.key : null)} onRefresh={() => threadState ? refreshThread() : refreshMessages(channelKey!)} onOpenThread={(target) => void openThread(target)} onCreatePoll={setPollMessage} onError={(error) => channelKey && setErrors((current) => ({ ...current, [channelKey]: error }))} onOptimisticReaction={optimisticallyToggleReaction} />) : null}
          </div>
           <MessageComposer key={`${organizationKey}:${channelKey ?? "none"}:${threadState?.thread.key ?? "channel"}`} organizationKey={organizationKey} channelKey={channelKey} orchestratorName={selected?.orchestrator.name ?? null} canChat={Boolean(selected?.canChat) && (!threadState || threadState.thread.status === "open")} streaming={channelKey ? Boolean(streaming[channelKey]) : false} error={channelKey ? errors[channelKey] ?? null : null} onSubmit={threadState && channelKey ? (content) => { void replyChorusThread(organizationKey, channelKey, threadState.thread.key, content).then(() => refreshThread()); } : submitComposerMessage} mentions={mentions} mentionRoster={mentionRoster} channelDrafts={channelDrafts.current} draftId={threadState?.thread.key ?? "channel"} />
        </section>
        <Dialog.Root open={clearOpen} onOpenChange={(open) => { if (!clearing) setClearOpen(open); }}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-obsidian-990/70" />
            <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,390px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--border-strong)] bg-obsidian-950 p-5 shadow-2xl" aria-describedby="clear-channel-description">
              <Dialog.Title className="text-sm text-silver-50">Clear this channel?</Dialog.Title>
              <Dialog.Description id="clear-channel-description" className="mt-2 text-[11px] leading-5 text-silver-400">This removes every message in your channel with {selected?.orchestrator.name ?? "this orchestrator"}.</Dialog.Description>
               <div className="mt-5 flex justify-end gap-2"><Dialog.Close asChild><Button type="button" variant="secondary" disabled={clearing} className="min-h-0 rounded-lg px-4 py-2 text-[10px]">Cancel</Button></Dialog.Close><Button type="button" variant="primary" loading={clearing} onClick={() => void clearSelectedChannel()} className="min-h-0 rounded-lg px-4 py-2 text-[10px]">{clearing ? "Clearing..." : "Clear channel"}</Button></div>
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
            await createChorusPoll(requestOrganization, requestChannel, pollMessage.key, question, options, allowMultiple);
            await refreshMessages(requestChannel);
            if (organizationGeneration.current === generation && activeChannel.current === requestChannel) setPollMessage(null);
          } catch (error) {
            if (organizationGeneration.current === generation) setErrors((current) => ({ ...current, [requestChannel]: error instanceof Error ? error.message : "Poll creation or refresh failed" }));
          } finally {
            if (organizationGeneration.current === generation) setBusyMessage(null);
          }
        }} /> : null}
        <Dialog.Root open={Boolean(actionMessage)} onOpenChange={(open) => { if (!open) closeMessageActions(); }}>
          <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-obsidian-990/70" /><Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-2xl border border-[var(--border-strong)] bg-obsidian-950 p-4 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[360px] sm:max-h-none sm:rounded-none" aria-describedby={undefined}>
            <div className="flex items-center justify-between"><Dialog.Title className="text-sm text-silver-50">Message actions</Dialog.Title><Dialog.Close asChild><Button variant="icon" aria-label="Close message actions" icon={<CloseIcon size="sm" />} className="h-8 min-h-0 w-8">Close message actions</Button></Dialog.Close></div>
            <div className="mt-4 grid gap-2"><Button type="button" variant="secondary" onClick={() => { if (actionMessage) void openThreadSheet(actionMessage); }} className="min-h-0 justify-start rounded-lg px-3 py-2 text-left text-xs normal-case tracking-normal">Threads</Button><Button type="button" variant="secondary" onClick={() => { setPollMessage(actionMessage); closeMessageActions(); }} className="min-h-0 justify-start rounded-lg px-3 py-2 text-left text-xs normal-case tracking-normal">Poll</Button><Button type="button" variant="secondary" onClick={() => { stopMessageSpeech(); setReactionPickerOpen(true); }} className="min-h-0 justify-start rounded-lg px-3 py-2 text-left text-xs normal-case tracking-normal">React</Button><Button type="button" variant="secondary" disabled={!actionMessage?.content || busyMessage === actionMessage?.key} onClick={() => void toggleMessageSpeech()} icon={<SoundwaveIcon size="sm" animated={Boolean(actionMessage && speechAudio.current.get(actionMessage.key) && (voicePlayingSrc === speechAudio.current.get(actionMessage.key) || pendingVoiceSrc === speechAudio.current.get(actionMessage.key)))} />} className="min-h-0 justify-start rounded-lg px-3 py-2 text-left text-xs normal-case tracking-normal">{actionMessage && speechAudio.current.get(actionMessage.key) && (voicePlayingSrc === speechAudio.current.get(actionMessage.key) || pendingVoiceSrc === speechAudio.current.get(actionMessage.key)) ? "Stop listening" : "Listen with Ash"}</Button><Button type="button" variant="danger" onClick={() => { if (!actionMessage || !channelKey) return; void deleteChorusMessage(organizationKey, channelKey, actionMessage.key).then(() => refreshMessages(channelKey)); closeMessageActions(); }} className="min-h-0 justify-start rounded-lg px-3 py-2 text-left text-xs normal-case tracking-normal">Delete message</Button></div>
            <div className="mt-auto flex justify-end border-t border-[var(--border-faint)] pt-4"><Dialog.Close asChild><Button variant="secondary" className="min-h-0 rounded-lg px-4 py-2 text-[10px]">Close</Button></Dialog.Close></div>
          </Dialog.Content></Dialog.Portal>
        </Dialog.Root>
        <Dialog.Root open={reactionPickerOpen} onOpenChange={setReactionPickerOpen}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-obsidian-990/70" /><Dialog.Content className="fixed inset-x-0 bottom-0 z-[60] flex max-h-[88vh] flex-col rounded-t-2xl border border-[var(--border-strong)] bg-obsidian-950 p-4 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[380px] sm:max-h-none sm:rounded-none" aria-describedby={undefined}><div className="flex items-center justify-between"><Dialog.Title className="text-sm text-silver-50">Reactions</Dialog.Title><Dialog.Close asChild><Button variant="icon" aria-label="Close reactions" icon={<CloseIcon size="sm" />} className="h-8 min-h-0 w-8">Close reactions</Button></Dialog.Close></div><input autoFocus value={reactionQuery} onChange={(event) => setReactionQuery(event.target.value)} placeholder="Search reactions" className="mt-4 w-full rounded-lg border border-[var(--border-faint)] bg-white/[0.04] px-3 py-2 text-xs text-silver-100 outline-none" /><div className="scrollbar-hide mt-4 grid min-h-0 flex-1 grid-cols-5 content-start gap-2 overflow-y-auto pr-1">{filteredReactions.map(({ emoji, name }) => <button key={emoji} type="button" aria-label={name} title={name} onClick={() => { if (!actionMessage || !channelKey) return; optimisticallyToggleReaction(actionMessage.key, emoji); void mutateChorusReaction(organizationKey, channelKey, actionMessage.key, emoji).then(() => threadState ? refreshThread() : refreshMessages(channelKey)); setReactionPickerOpen(false); setActionMessage(null); }} className="flex h-11 items-center justify-center rounded-lg border border-[var(--border-soft)] text-lg">{emoji}</button>)}</div><div className="mt-5 flex justify-end border-t border-[var(--border-faint)] pt-4"><Dialog.Close asChild><Button variant="secondary" className="min-h-0 rounded-lg px-4 py-2 text-[10px]">Close</Button></Dialog.Close></div></Dialog.Content></Dialog.Portal></Dialog.Root>
        <Dialog.Root open={threadSheetOpen} onOpenChange={setThreadSheetOpen}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-obsidian-990/70" /><Dialog.Content className="fixed inset-x-0 bottom-0 z-[60] flex max-h-[88vh] flex-col rounded-t-2xl border border-[var(--border-strong)] bg-obsidian-950 p-4 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[400px] sm:max-h-none sm:rounded-none" aria-describedby={undefined}>
          <div className="flex items-center justify-between"><Dialog.Title className="text-sm text-silver-50">Threads</Dialog.Title><Dialog.Close asChild><Button variant="icon" aria-label="Close threads" icon={<CloseIcon size="sm" />} className="h-8 min-h-0 w-8">Close threads</Button></Dialog.Close></div>
          <div className="scrollbar-hide mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto">{newThreadOpen ? <div><label className="text-[10px] text-silver-400" htmlFor="thread-title">Thread name</label><input id="thread-title" autoFocus maxLength={50} value={newThreadTitle} onChange={(event) => setNewThreadTitle(event.target.value)} placeholder="Name this thread" className="mt-2 w-full rounded-lg border border-[var(--border-faint)] bg-white/[0.04] px-3 py-2 text-xs text-silver-100 outline-none" /><p className="mt-2 text-right font-mono text-[9px] text-silver-600">{newThreadTitle.length}/50</p></div> : threadItems.length ? threadItems.map((thread) => <button key={thread.key} type="button" onClick={() => { const root = visibleMessages.find((message) => message.key === thread.rootMessageKey); if (root) void openThread(root, thread.key); setThreadSheetOpen(false); }} className="block w-full rounded-lg border border-[var(--border-soft)] p-3 text-left"><span className="block text-xs text-silver-100">{thread.title}</span><span className="mt-1 block truncate text-[10px] text-silver-500">{thread.rootContent}</span><span className="mt-1 block text-[9px] text-silver-600">{thread.replyCount} replies</span></button>) : <p className="py-8 text-center text-xs text-silver-500">No threads yet.</p>}</div>
          <div className="mt-5 border-t border-[var(--border-faint)] pt-4"><div className="flex justify-end gap-2"><Dialog.Close asChild><Button variant="secondary" className="min-h-0 rounded-lg px-4 py-2 text-[10px]">Close</Button></Dialog.Close>{newThreadOpen ? <Button type="button" variant="primary" disabled={!threadRoot || !channelKey || !newThreadTitle.trim()} onClick={() => { if (!threadRoot || !channelKey) return; void createChorusThread(organizationKey, channelKey, threadRoot.key, newThreadTitle.trim()).then((thread) => { setThreadSheetOpen(false); setNewThreadOpen(false); void openThread(threadRoot, thread.key); void refreshMessages(channelKey); }); }} className="min-h-0 rounded-lg px-4 py-2 text-[10px]">Create thread</Button> : <Button type="button" variant="primary" onClick={() => setNewThreadOpen(true)} className="min-h-0 rounded-lg px-4 py-2 text-[10px]">New thread</Button>}</div></div>
        </Dialog.Content></Dialog.Portal></Dialog.Root>
      </div>
    </div>
  );
}
