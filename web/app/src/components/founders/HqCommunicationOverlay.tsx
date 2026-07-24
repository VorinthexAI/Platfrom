"use client";

import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { memo, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronUpIcon, CloseIcon } from "@vorinthex/shared/ui/icons";
import { SpeakerIcon } from "@/components/ui/SpeakerIcon";
import { orchestratorMessageUrl, useAudioStore } from "@/lib/audio/audio-store";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { entityLogoThumbnailUrl } from "@/lib/three/entity-logo";
import {
  closeChorusPoll,
  createChorusPoll,
  createChorusThread,
  listChorusChannels,
  listChorusMessages,
  markChorusStreamFailed,
  mergeChorusMessageRefresh,
  mutateChorusReaction,
  readChorusThread,
  replyChorusThread,
  resolveChorusThread,
  reconcileChorusStreamEvent,
  streamChorusMessage,
  voteChorusPoll,
  type ChorusChannelEntry,
  type ChorusDisplayMessage,
  type ChorusMessage,
  type ChorusThread,
  type ChorusStreamEvent,
} from "@/lib/founders/chorus";
import { createFrameBatcher } from "@/lib/founders/frame-batcher";

interface HqCommunicationOverlayProps {
  organizationKey: string;
  selectedScopeId: string;
  onScopeChange: (id: string) => void;
}

const registryOrchestrators = Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators);
const normalizeName = (name: string) => name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
const registryByName = new Map(registryOrchestrators.map((entity) => [normalizeName(entity.name), entity]));
const REACTIONS = ["ack", "approve", "insight", "question"] as const;

function entityFor(entry: ChorusChannelEntry): GalaxyEntity | null {
  return registryByName.get(normalizeName(entry.orchestrator.name)) ?? null;
}

const PersonMark = memo(function PersonMark({ entry, size = 34 }: { entry: ChorusChannelEntry; size?: number }) {
  const entity = entityFor(entry);
  return entity ? (
    <span className="relative inline-flex shrink-0 overflow-hidden rounded-full border border-[var(--border-soft)] bg-obsidian-990/85" style={{ width: size, height: size }}>
      <Image src={entityLogoThumbnailUrl("orchestrator", entity.slug)} alt={`${entry.orchestrator.name} emblem`} fill sizes={`${size}px`} unoptimized className="object-contain p-[2px]" />
    </span>
  ) : (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full border border-[var(--border-soft)] bg-obsidian-900 font-mono text-[9px] text-silver-300" style={{ width: size, height: size }}>
      {entry.orchestrator.name.slice(0, 2).toUpperCase()}
    </span>
  );
});

function Timestamp({ value }: { value: string }) {
  const label = `${value.slice(11, 16)} UTC`;
  return <time dateTime={value} title={value} className="font-mono text-[9px] text-silver-600">{label}</time>;
}

interface RailProps {
  channels: ChorusChannelEntry[];
  selectedKey: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (entry: ChorusChannelEntry) => void;
}

const OrchestratorRail = memo(function OrchestratorRail({ channels, selectedKey, loading, error, onRetry, onSelect }: RailProps) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-[var(--border-faint)] bg-obsidian-950/90 [contain:layout_paint]">
      <div className="border-b border-[var(--border-faint)] px-4 py-3">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-silver-500">Chorus channels</span>
      </div>
      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [contain:content]">
        {loading ? <div aria-label="Loading channels" className="space-y-2">{[0, 1, 2, 3].map((item) => <div key={item} className="h-10 animate-pulse rounded-lg bg-white/[0.04]" />)}</div> : null}
        {error ? <div role="alert" className="rounded-xl border border-status-critical/30 p-3 text-[11px] text-status-critical"><p>{error}</p><button type="button" onClick={onRetry} className="mt-2 rounded-md border border-current px-2 py-1 focus-visible:outline-2">Retry</button></div> : null}
        {!loading && !error && channels.length === 0 ? <p className="p-2 text-[11px] text-silver-500">No Chorus channels are available.</p> : null}
        <div className="space-y-1">
          {channels.map((entry) => {
            const selected = entry.orchestrator.key === selectedKey;
            return (
              <button key={entry.orchestrator.key} type="button" aria-current={selected ? "page" : undefined} aria-label={`${entry.orchestrator.name}${entry.canChat ? "" : ", chat unavailable"}`} onClick={() => onSelect(entry)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-silver-300 ${selected ? "bg-[var(--panel-strong)] text-silver-50" : "text-silver-300 hover:bg-white/[0.04]"} ${entry.canChat ? "" : "opacity-55"}`}>
                <PersonMark entry={entry} size={25} />
                <span className="min-w-0 flex-1 truncate text-[12px]">{entry.orchestrator.name}</span>
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
      {poll.status === "open" && message.author.type === "user" ? <button type="button" disabled={busy} onClick={() => void mutate(() => closeChorusPoll(organizationKey, channelKey, poll.key))} className="mt-2 text-[9px] text-silver-500 underline hover:text-silver-200 focus-visible:outline-2">Close poll</button> : null}
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
}

const MessageView = memo(function MessageView({ entry, message, organizationKey, busy, onBusy, onRefresh, onOpenThread, onCreatePoll, onError, onOptimisticReaction }: MessageViewProps) {
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
    <article className="group flex gap-3 px-1 py-3">
      {message.author.type === "orchestrator" ? <PersonMark entry={entry} size={36} /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-soft)] bg-obsidian-850 font-mono text-[8px] text-silver-200">YOU</span>}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2"><h3 className="text-[12px] font-medium text-silver-50">{message.author.type === "user" ? "You" : message.author.name}</h3><Timestamp value={message.createdAt} /></div>
        <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-silver-300">{message.content || (message.clientState?.state === "failed" ? <span className="text-status-critical">No response was received.</span> : <span className="animate-pulse text-silver-500">Thinking...</span>)}</p>
        {message.clientState ? <p role={message.clientState.state === "failed" ? "alert" : "status"} className={`mt-1 font-mono text-[8px] uppercase ${message.clientState.state === "failed" ? "text-status-critical" : "text-silver-600"}`}>{message.clientState.state === "failed" ? message.clientState.error ?? "Message reconciliation failed" : message.author.type === "user" ? "Sending" : "Response pending"}</p> : null}
        {interactive ? <PollView organizationKey={organizationKey} channelKey={channelKey} message={message} busy={busy} onBusy={onBusy} onRefresh={onRefresh} onError={onError} /> : null}
        {interactive ? <div className="mt-1.5 flex flex-wrap items-center gap-1 opacity-80 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {REACTIONS.map((reaction) => {
            const aggregate = message.reactions.find((item) => item.reaction === reaction);
            return <button key={reaction} type="button" disabled={busy} aria-label={`${aggregate?.viewerReacted ? "Remove" : "Add"} ${reaction} reaction`} aria-pressed={aggregate?.viewerReacted ?? false} onClick={() => void react(reaction)} className={`rounded-full border px-2 py-0.5 font-mono text-[8px] focus-visible:outline-2 disabled:opacity-40 ${aggregate?.viewerReacted ? "border-silver-400 bg-white/[0.08] text-silver-100" : "border-[var(--border-faint)] text-silver-500"}`}>{reaction}{aggregate ? ` ${aggregate.count}` : ""}</button>;
          })}
          {!message.threadKey ? <button type="button" onClick={() => onOpenThread(message)} className="px-1 text-[9px] text-silver-500 underline focus-visible:outline-2">{message.thread ? `${message.thread.replyCount} replies` : "Thread"}</button> : null}
          {message.author.type === "user" && !message.poll && !message.threadKey ? <button type="button" onClick={() => onCreatePoll(message)} className="px-1 text-[9px] text-silver-500 underline focus-visible:outline-2">Poll</button> : null}
        </div> : null}
      </div>
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
        <Dialog.Content className="fixed inset-x-3 bottom-3 z-50 rounded-xl border border-[var(--border-strong)] bg-obsidian-950 p-3 shadow-2xl sm:left-auto sm:right-3 sm:w-[420px]" aria-describedby={undefined}>
    <form onSubmit={(event) => { event.preventDefault(); void onCreate(question.trim(), validOptions, allowMultiple); }} aria-label={`Create poll for message: ${message.content.slice(0, 40)}`}>
      <div className="flex justify-between"><Dialog.Title className="text-xs text-silver-100">Create poll</Dialog.Title><Dialog.Close type="button" disabled={busy} aria-label="Cancel poll creation"><CloseIcon size="sm" /></Dialog.Close></div>
      <input autoFocus value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} placeholder="Question" aria-label="Poll question" className="mt-3 w-full rounded-md border border-[var(--border-faint)] bg-white/[0.04] px-2 py-1.5 text-[11px] text-white outline-none focus:border-silver-500" />
      {options.map((option, index) => <input key={index} value={option} onChange={(event) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} maxLength={200} placeholder={`Option ${index + 1}`} aria-label={`Poll option ${index + 1}`} className="mt-1.5 w-full rounded-md border border-[var(--border-faint)] bg-white/[0.04] px-2 py-1.5 text-[11px] text-white outline-none focus:border-silver-500" />)}
      <div className="mt-2 flex items-center justify-between"><label className="text-[10px] text-silver-400"><input type="checkbox" checked={allowMultiple} onChange={(event) => setAllowMultiple(event.target.checked)} className="mr-1" />Multiple choices</label>{options.length < 6 ? <button type="button" onClick={() => setOptions((current) => [...current, ""])} className="text-[9px] text-silver-400 underline">Add option</button> : null}</div>
      {error ? <p role="alert" className="mt-2 text-[10px] text-status-critical">{error}</p> : null}
      <button type="submit" disabled={busy || !question.trim() || validOptions.length < 2 || new Set(validOptions.map((option) => option.toLowerCase())).size !== validOptions.length} className="mt-3 rounded-md bg-silver-200 px-3 py-1.5 text-[10px] text-obsidian-990 disabled:opacity-35">Create</button>
    </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ThreadPanelProps {
  entry: ChorusChannelEntry;
  thread: ChorusThread;
  messages: ChorusMessage[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onReply: (content: string) => Promise<void>;
  onResolve: () => Promise<void>;
}

function ThreadPanel({ entry, thread, messages, loading, error, onClose, onReply, onResolve }: ThreadPanelProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!draft.trim() || busy) return; setBusy(true); try { await onReply(draft.trim()); setDraft(""); } catch { /* The parent renders the request error and the draft stays intact. */ } finally { setBusy(false); } };
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-obsidian-990/55" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-[var(--border-strong)] bg-obsidian-950/98 shadow-2xl sm:w-[420px]" aria-describedby={undefined}>
      <header className="flex h-14 items-center justify-between border-b border-[var(--border-faint)] px-4"><div><Dialog.Title className="text-xs text-silver-100">{thread.title ?? "Thread"}</Dialog.Title><span className="font-mono text-[8px] uppercase text-silver-500">{thread.status}</span></div><Dialog.Close type="button" aria-label="Close thread panel" className="rounded focus-visible:outline-2"><CloseIcon size="sm" /></Dialog.Close></header>
      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite">
        {loading ? <p className="animate-pulse text-[11px] text-silver-500">Loading thread...</p> : messages.map((message) => <div key={message.key} className="border-b border-[var(--border-faint)] py-3"><div className="flex items-center gap-2 text-[10px] text-silver-400">{message.author.type === "orchestrator" ? entry.orchestrator.name : "You"}<Timestamp value={message.createdAt} /></div><p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-silver-200">{message.content}</p></div>)}
        {error ? <p role="alert" className="mt-2 text-[10px] text-status-critical">{error}</p> : null}
      </div>
      <div className="border-t border-[var(--border-faint)] p-3">
        {thread.status === "open" ? <form onSubmit={submit}><textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={8000} aria-label="Thread reply" placeholder="Reply to thread" className="w-full resize-none rounded-lg border border-[var(--border-faint)] bg-white/[0.04] p-2 text-[11px] text-white outline-none focus:border-silver-500" /><div className="mt-2 flex justify-between"><button type="button" disabled={busy} onClick={() => { setBusy(true); void onResolve().catch(() => {}).finally(() => setBusy(false)); }} className="text-[9px] text-silver-400 underline disabled:opacity-40">Resolve thread</button><button type="submit" disabled={busy || !draft.trim()} className="rounded bg-silver-200 px-3 py-1 text-[10px] text-obsidian-990 disabled:opacity-35">Reply</button></div></form> : <p className="text-[10px] text-silver-500">This thread is {thread.status} and cannot receive replies.</p>}
      </div>
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
}

const MessageComposer = memo(function MessageComposer({ organizationKey, channelKey, orchestratorName, canChat, streaming, error, onSubmit }: MessageComposerProps) {
  const channelDrafts = useRef(new Map<string, string>());
  const [draft, setDraft] = useState("");
  const draftKey = channelKey ? `${organizationKey}:${channelKey}` : null;

  useEffect(() => {
    setDraft(draftKey ? channelDrafts.current.get(draftKey) ?? "" : "");
  }, [draftKey]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !channelKey || !canChat || streaming) return;
    channelDrafts.current.set(`${organizationKey}:${channelKey}`, "");
    setDraft("");
    onSubmit(content);
  };

  const placeholder = orchestratorName
    ? canChat ? `Ask ${orchestratorName}...` : `Chat permission required for ${orchestratorName}`
    : "Select a channel";

  return (
    <div className="shrink-0 p-3 sm:p-4">
      <form onSubmit={submit} className="rounded-xl border border-[var(--border-soft)] bg-obsidian-900/90 p-3 focus-within:border-[var(--border-strong)]">
        <textarea
          value={draft}
          onChange={(event) => {
            const value = event.target.value;
            setDraft(value);
            if (draftKey) channelDrafts.current.set(draftKey, value);
          }}
          onKeyDown={(event) => {
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
            {error ? error : streaming ? `${orchestratorName} is responding...` : !canChat && orchestratorName ? `You lack permission to chat with ${orchestratorName}.` : null}
          </span>
          <button type="submit" disabled={!canChat || !channelKey || streaming || !draft.trim()} aria-label={orchestratorName ? `Send message to ${orchestratorName}` : "Send message"} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--gradient-chrome)] text-obsidian-990 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-35">
            <ChevronUpIcon aria-hidden size="sm" strokeWidth={2.2} />
          </button>
        </div>
      </form>
    </div>
  );
});

export default function HqCommunicationOverlay({ organizationKey, selectedScopeId, onScopeChange }: HqCommunicationOverlayProps) {
  const [channels, setChannels] = useState<ChorusChannelEntry[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, ChorusDisplayMessage[]>>({});
  const [messagesLoading, setMessagesLoading] = useState<Record<string, boolean>>({});
  const [streaming, setStreaming] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [pollMessage, setPollMessage] = useState<ChorusMessage | null>(null);
  const [threadState, setThreadState] = useState<{ thread: ChorusThread; messages: ChorusMessage[]; loading: boolean; error: string | null } | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const messageRequests = useRef(new Map<string, number>());
  const organizationGeneration = useRef(0);
  const threadGeneration = useRef(0);
  const currentOrganization = useRef(organizationKey);
  const activeChannel = useRef<string | null>(null);
  const messagesPane = useRef<HTMLDivElement>(null);
  const shouldFollowMessages = useRef(true);
  const stopVoice = useAudioStore((state) => state.stopVoice);
  const playVoice = useAudioStore((state) => state.playVoice);
  const voicePlayingSrc = useAudioStore((state) => state.voicePlayingSrc);
  currentOrganization.current = organizationKey;

  const loadChannels = useCallback(async () => {
    const generation = ++organizationGeneration.current;
    currentOrganization.current = organizationKey;
    threadGeneration.current += 1;
    for (const active of controllers.current.values()) active.abort();
    controllers.current.clear();
    messageRequests.current.clear();
    activeChannel.current = null;
    setChannels([]); setMessages({}); setMessagesLoading({}); setStreaming({}); setErrors({}); setSelectedKey(null); setThreadState(null); setPollMessage(null); setBusyMessage(null);
    setChannelsLoading(true); setChannelsError(null);
    const controller = new AbortController();
    controllers.current.get("channels")?.abort(); controllers.current.set("channels", controller);
    try {
      const loaded = await listChorusChannels(organizationKey, controller.signal);
      if (controller.signal.aborted || organizationGeneration.current !== generation || currentOrganization.current !== organizationKey) return;
      setChannels(loaded);
      setSelectedKey((current) => loaded.some((entry) => entry.orchestrator.key === current) ? current : (loaded.find((entry) => normalizeName(entry.orchestrator.name) === "atlas") ?? loaded[0])?.orchestrator.key ?? null);
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
  const selectedEntity = selected ? entityFor(selected) : null;
  const selectedVoiceSrc = selectedEntity && selected?.canChat ? orchestratorMessageUrl(selectedEntity.slug) : null;
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
  useEffect(() => () => stopVoice(), [organizationKey, channelKey, selectedVoiceSrc, stopVoice]);

  const selectChannel = useCallback((entry: ChorusChannelEntry) => {
    threadGeneration.current += 1;
    controllers.current.get("thread")?.abort();
    activeChannel.current = entry.channel?.key ?? null;
    setSelectedKey(entry.orchestrator.key); setPollMessage(null); setThreadState(null);
    const entity = entityFor(entry); if (entity) onScopeChange(entity.id);
    if (entry.orchestrator.key === selectedKey && entry.canChat && entry.channel) void refreshMessages(entry.channel.key).catch(() => {});
  }, [onScopeChange, refreshMessages, selectedKey]);
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
      setMessages((current) => ({ ...current, [channelKey]: events.reduce((channelMessages, streamEvent) => reconcileChorusStreamEvent(channelMessages, stream, streamEvent), current[channelKey] ?? []) }));
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

  const openThread = async (message: ChorusMessage) => {
    if (!channelKey) return;
    const generation = ++threadGeneration.current;
    const requestOrganization = organizationKey;
    const controller = new AbortController();
    controllers.current.get("thread")?.abort(); controllers.current.set("thread", controller);
    setErrors((current) => ({ ...current, [channelKey]: null }));
    try {
      const thread = message.thread ? { key: message.thread.key } : await createChorusThread(organizationKey, channelKey, message.key, undefined, controller.signal);
      const placeholder = "rootMessageKey" in thread ? thread : { key: thread.key, channelKey, rootMessageKey: message.key, status: message.thread?.status ?? "open", createdAt: message.createdAt, updatedAt: message.updatedAt };
      if (controller.signal.aborted || threadGeneration.current !== generation || activeChannel.current !== channelKey || currentOrganization.current !== requestOrganization) return;
      setThreadState({ thread: placeholder, messages: [message], loading: true, error: null });
      const loaded = await readChorusThread(organizationKey, channelKey, thread.key, controller.signal);
      if (!controller.signal.aborted && threadGeneration.current === generation && activeChannel.current === channelKey && currentOrganization.current === requestOrganization) setThreadState({ ...loaded, loading: false, error: null });
      await refreshMessages(channelKey).catch(() => {});
    } catch (error) { if (!controller.signal.aborted && threadGeneration.current === generation) setErrors((current) => ({ ...current, [channelKey]: error instanceof Error ? error.message : "Thread could not open" })); }
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
  return (
    <div data-scope-id={selectedScopeId} className="pointer-events-auto absolute inset-0 z-10 flex min-h-0 flex-col p-1.5 sm:p-2.5">
      <header className="flex h-12 shrink-0 items-center border border-[var(--border-faint)] bg-obsidian-990/90 px-3 sm:h-14 sm:px-4">
        <Image src="/logos/vorinthex-mark.png" alt="Vorinthex" width={23} height={23} className="opacity-90" />
        <div className="ml-3 min-w-0 flex-1 font-mono text-[9px] uppercase tracking-[0.13em] text-silver-500"><span className="text-silver-300">HQ</span><span className="mx-2">/</span><span className="truncate">{selected?.orchestrator.name ?? "Chorus"}</span></div>
        <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-silver-600">Persistent comms</span>
      </header>
      <div className="relative grid min-h-0 flex-1 grid-rows-[minmax(150px,30vh)_minmax(0,1fr)] overflow-hidden border-x border-b border-[var(--border-faint)] md:grid-cols-[248px_minmax(0,1fr)] md:grid-rows-1">
        <OrchestratorRail channels={channels} selectedKey={selectedKey} loading={channelsLoading} error={channelsError} onRetry={retryChannels} onSelect={selectChannel} />
        <section className="flex min-h-0 min-w-0 flex-col bg-obsidian-990/90 [contain:layout_paint]">
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--border-faint)] px-5">
            {selected ? <PersonMark entry={selected} size={34} /> : null}<div className="min-w-0"><h1 className="truncate font-display text-base text-silver-50">{selected?.orchestrator.name ?? "Chorus"}</h1><p className="truncate text-[9px] text-silver-500">{selected?.orchestrator.role ?? "Select a channel"}</p></div>
            {selectedVoiceSrc && selected ? <button type="button" aria-pressed={voicePlayingSrc === selectedVoiceSrc} aria-label={`${voicePlayingSrc === selectedVoiceSrc ? "Stop" : "Play"} Meet ${selected.orchestrator.name}`} onClick={() => playVoice(selectedVoiceSrc)} className={`ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border focus-visible:outline-2 ${voicePlayingSrc === selectedVoiceSrc ? "border-silver-300 bg-white/10 text-silver-50" : "border-[var(--border-soft)] text-silver-400 hover:border-silver-500 hover:text-silver-100"}`}><SpeakerIcon animated={voicePlayingSrc === selectedVoiceSrc} /></button> : null}
          </div>
          <div ref={messagesPane} onScroll={(event) => { const pane = event.currentTarget; shouldFollowMessages.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 96; }} className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2 [contain:content] sm:px-6" aria-live="polite" aria-busy={channelKey ? Boolean(messagesLoading[channelKey]) : false}>
            {selected && !selected.canChat ? <div className="flex h-full items-center justify-center text-center text-[12px] text-silver-300">You lack permission to chat with {selected.orchestrator.name}.</div> : null}
            {selected?.canChat && channelKey && messagesLoading[channelKey] && !messages[channelKey] ? <div className="space-y-3 py-4">{[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-lg bg-white/[0.03]" />)}</div> : null}
            {selected?.canChat && channelKey && !messagesLoading[channelKey] && visibleMessages.length === 0 ? <div className="flex h-full items-center justify-center text-center"><p className="text-[12px] text-silver-400">Start a persisted conversation with {selected.orchestrator.name}.</p></div> : null}
            {selected?.canChat ? visibleMessages.map((message) => <MessageView key={message.key} entry={selected} message={message} organizationKey={organizationKey} busy={busyMessage === message.key} onBusy={(busy) => setBusyMessage(busy ? message.key : null)} onRefresh={() => refreshMessages(channelKey!)} onOpenThread={(target) => void openThread(target)} onCreatePoll={setPollMessage} onError={(error) => channelKey && setErrors((current) => ({ ...current, [channelKey]: error }))} onOptimisticReaction={(messageKey, reaction) => channelKey && setMessages((current) => ({ ...current, [channelKey]: (current[channelKey] ?? []).map((item) => {
              if (item.key !== messageKey) return item;
              const existing = item.reactions.find((entry) => entry.reaction === reaction);
              const reactions = existing
                ? item.reactions.map((entry) => entry.reaction === reaction ? { ...entry, count: entry.count + (entry.viewerReacted ? -1 : 1), viewerReacted: !entry.viewerReacted } : entry).filter((entry) => entry.count > 0)
                : [...item.reactions, { reaction, count: 1, viewerReacted: true }];
              return { ...item, reactions };
            }) }))} />) : null}
          </div>
          <MessageComposer organizationKey={organizationKey} channelKey={channelKey} orchestratorName={selected?.orchestrator.name ?? null} canChat={Boolean(selected?.canChat)} streaming={channelKey ? Boolean(streaming[channelKey]) : false} error={channelKey ? errors[channelKey] ?? null : null} onSubmit={submitComposerMessage} />
        </section>
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
        {selected && channelKey && threadState ? <ThreadPanel entry={selected} {...threadState} onClose={() => {
          threadGeneration.current += 1;
          controllers.current.get("thread")?.abort();
          controllers.current.get("thread-refresh")?.abort();
          controllers.current.get("thread-mutation")?.abort();
          setThreadState(null);
        }} onReply={async (content) => {
          const requestThread = threadState.thread.key;
          const generation = threadGeneration.current;
          const controller = new AbortController();
          controllers.current.get("thread-mutation")?.abort(); controllers.current.set("thread-mutation", controller);
          try {
            await replyChorusThread(organizationKey, channelKey, requestThread, content, undefined, controller.signal);
          } catch (error) {
            if (!controller.signal.aborted && threadGeneration.current === generation) setThreadState((current) => current?.thread.key === requestThread ? { ...current, error: error instanceof Error ? error.message : "Reply could not be sent" } : current);
            throw error;
          }
          if (controller.signal.aborted || threadGeneration.current !== generation || activeChannel.current !== channelKey) return;
          const refreshes = await Promise.allSettled([refreshThread(), refreshMessages(channelKey)]);
          if (refreshes.some((result) => result.status === "rejected") && threadGeneration.current === generation) setThreadState((current) => current?.thread.key === requestThread ? { ...current, error: "Reply sent, but the thread could not be refreshed." } : current);
        }} onResolve={async () => {
          const requestThread = threadState.thread.key;
          const generation = threadGeneration.current;
          const controller = new AbortController();
          controllers.current.get("thread-mutation")?.abort(); controllers.current.set("thread-mutation", controller);
          try {
            await resolveChorusThread(organizationKey, channelKey, requestThread, controller.signal);
          } catch (error) {
            if (!controller.signal.aborted && threadGeneration.current === generation) setThreadState((current) => current?.thread.key === requestThread ? { ...current, error: error instanceof Error ? error.message : "Thread could not resolve" } : current);
            throw error;
          }
          if (controller.signal.aborted || threadGeneration.current !== generation || activeChannel.current !== channelKey) return;
          const refreshes = await Promise.allSettled([refreshThread(), refreshMessages(channelKey)]);
          if (refreshes.some((result) => result.status === "rejected") && threadGeneration.current === generation) setThreadState((current) => current?.thread.key === requestThread ? { ...current, error: "Thread resolved, but its canonical state could not be refreshed." } : current);
        }} /> : null}
      </div>
    </div>
  );
}
