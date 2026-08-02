import { z } from "zod";

const keySchema = z.string().trim().min(1).max(160);
const isoTimestampSchema = z.string().datetime({ offset: true });
const optionalKeySchema = z.preprocess((value) => value === null ? undefined : value, keySchema.optional());

export const CHORUS_ORCHESTRATOR_NAMES = ["Atlas", "Metis", "Echo", "Matrix", "Hermes", "Harmony", "Phoenix", "Iris", "Orbit", "Apollo", "Athena", "Forge", "Aura", "Pillar", "Helios", "Vulcan", "Ledger", "Mercury", "Sentinel", "Themis"] as const;

export const chorusChannelSchema = z.object({
  key: keySchema,
  organizationKey: keySchema,
  scopeKey: keySchema,
  kind: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  position: z.number().int(),
  archivedAt: isoTimestampSchema.optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
}).strict();

export const chorusMentionSchema = z.object({ participantKey: keySchema, type: z.enum(["user", "orchestrator", "everyone"]), key: keySchema, name: z.string().trim().min(1), role: z.string().optional(), mentionCount: z.number().int().nonnegative() }).strict();
export const chorusMentionRosterSchema = z.object({
  orchestrators: z.array(chorusMentionSchema.extend({ type: z.literal("orchestrator") })).length(20),
  everyone: chorusMentionSchema.extend({ type: z.literal("everyone") }),
  members: z.array(chorusMentionSchema.extend({ type: z.literal("user") })),
}).strict();
export const chorusChannelEntrySchema = z.object({
  orchestrator: z.object({ key: keySchema, name: z.string().trim().min(1), role: z.string() }).strict(),
  scopeKey: keySchema,
  canChat: z.boolean(),
  channel: chorusChannelSchema.nullable(),
}).strict().superRefine((entry, context) => {
  if (entry.canChat && !entry.channel) context.addIssue({ code: "custom", message: "Chat-enabled channel is missing" });
  if (!entry.canChat && entry.channel) context.addIssue({ code: "custom", message: "Unavailable channel must be null" });
});

export const chorusPollSchema = z.object({
  key: keySchema,
  question: z.string().trim().min(1),
  allowMultiple: z.boolean(),
  status: z.enum(["open", "closed"]),
  closedAt: isoTimestampSchema.nullable().optional(),
  options: z.array(z.object({
    key: keySchema,
    text: z.string().trim().min(1),
    position: z.number().int().nonnegative(),
    voteCount: z.number().int().nonnegative(),
    viewerVoted: z.boolean(),
  }).strict()).min(2),
}).strict();

export const chorusMessageSchema = z.object({
  key: keySchema,
  channelKey: keySchema,
  threadKey: optionalKeySchema,
  replyToMessageKey: optionalKeySchema,
  content: z.string(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  author: z.object({
    participantKey: keySchema,
    type: z.enum(["user", "orchestrator"]),
    key: keySchema,
    name: z.string().trim().min(1),
  }).strict(),
  reactions: z.array(z.object({ reaction: z.string().trim().min(1).max(64), count: z.number().int().positive(), viewerReacted: z.boolean() }).strict()),
  replies: z.object({ count: z.number().int().nonnegative() }).strict(),
  poll: chorusPollSchema.nullable(),
}).strict();

export const chorusTypingEventSchema = z.object({
  organizationKey: keySchema,
  channelKey: keySchema,
  participantKey: keySchema,
  type: z.enum(["user", "orchestrator"]),
  name: z.string().trim().min(1).max(160),
  active: z.boolean(),
  expiresAt: z.number().int().nonnegative(),
}).strict();

export const chorusStreamMessageSchema = z.object({
  key: keySchema,
  channelKey: keySchema,
  threadKey: keySchema.optional(),
  replyToMessageKey: keySchema.optional(),
  content: z.string(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
}).strict();

export const chorusStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), channelKey: keySchema, userMessage: chorusStreamMessageSchema }).strict(),
  z.object({ type: z.literal("assistant-start"), orchestrator: z.object({ participantKey: keySchema, key: keySchema, name: z.string().trim().min(1) }).strict() }).strict(),
  z.object({ type: z.literal("assistant-error"), orchestratorKey: keySchema }).strict(),
  z.object({ type: z.literal("token"), orchestratorKey: keySchema, text: z.string() }).strict(),
  z.object({ type: z.literal("done"), orchestratorKey: keySchema, message: chorusStreamMessageSchema }).strict(),
  z.object({ type: z.literal("complete") }).strict(),
  z.object({ type: z.literal("error"), error: z.string().trim().min(1) }).strict(),
]);

export type ChorusChannel = z.infer<typeof chorusChannelSchema>;
export type ChorusMention = z.infer<typeof chorusMentionSchema>;
export type ChorusMentionRoster = z.infer<typeof chorusMentionRosterSchema>;
export type ChorusChannelEntry = z.infer<typeof chorusChannelEntrySchema>;
export type ChorusMessage = z.infer<typeof chorusMessageSchema>;
export type ChorusPoll = z.infer<typeof chorusPollSchema>;
export type ChorusStreamEvent = z.infer<typeof chorusStreamEventSchema>;
export type ChorusTypingEvent = z.infer<typeof chorusTypingEventSchema>;
export type ChorusDisplayState = "optimistic" | "pending" | "reconciling" | "failed";
export type ChorusDisplayMessage = ChorusMessage & {
  clientState?: { streamKey: string; state: ChorusDisplayState; error?: string };
};

export interface ChorusOptimisticStream {
  streamKey: string;
  userKey: string;
  channelKey: string;
}

export function buildChorusMentionRows(roster: ChorusMentionRoster) {
  const orchestrators: ChorusMention[] = roster.orchestrators;
  const people: ChorusMention[] = [roster.everyone, ...roster.members];
  return {
    ordered: [...orchestrators, ...people],
    orchestrators,
    people,
  };
}

export function activeChorusMentionQuery(draft: string): string | null {
  return /(?:^|[^\w])@([\w-]*)$/i.exec(draft)?.[1].toLocaleLowerCase() ?? null;
}

export function filterChorusMentionShortcuts(mentions: ChorusMention[], query: string | null): ChorusMention[] {
  return query === null ? mentions : mentions.filter((mention) => mention.name.toLocaleLowerCase().startsWith(query));
}

export function closestChorusMentionCompletion(mentions: ChorusMention[], draft: string): { mention: ChorusMention; suffix: string } | null {
  const query = activeChorusMentionQuery(draft);
  if (!query) return null;
  const mention = mentions.find((candidate) => candidate.name.toLocaleLowerCase().startsWith(query));
  if (!mention || mention.name.length === query.length) return null;
  return { mention, suffix: mention.name.slice(query.length) };
}

export function formatChorusTypingLabel(names: string[]): string {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (!unique.length) return "";
  const subjects = unique.length === 1 ? unique[0] : `${unique.slice(0, -1).join(", ")} & ${unique.at(-1)}`;
  return `${subjects} ${unique.length === 1 ? "is" : "are"} typing...`;
}

export function directChorusReplies(messages: ChorusDisplayMessage[], parent: ChorusDisplayMessage): ChorusDisplayMessage[] {
  const legacyRootKey = messages.find((message) => !message.threadKey && !message.replyToMessageKey)?.key;
  return messages.filter((message) => message.replyToMessageKey === parent.key || (parent.key === legacyRootKey && Boolean(message.threadKey) && !message.replyToMessageKey));
}

export function chorusReplyCount(messages: ChorusDisplayMessage[], parent: ChorusDisplayMessage): number {
  return Math.max(parent.replies.count, directChorusReplies(messages, parent).length);
}

export function reconcileChorusStreamEvent(messages: ChorusDisplayMessage[], stream: ChorusOptimisticStream, event: ChorusStreamEvent): ChorusDisplayMessage[] {
  if (event.type === "assistant-start") {
    if (messages.some((message) => message.clientState?.streamKey === stream.streamKey && message.author.key === event.orchestrator.key)) return messages;
    const userMessage = messages.find((message) => message.clientState?.streamKey === stream.streamKey && message.author.type === "user");
    const now = new Date().toISOString();
    return [...messages, {
      key: `optimistic-assistant-${stream.streamKey}-${event.orchestrator.key}`,
      channelKey: stream.channelKey,
      ...(userMessage?.threadKey ? { threadKey: userMessage.threadKey } : {}),
      ...(userMessage?.replyToMessageKey ? { replyToMessageKey: userMessage.replyToMessageKey } : {}),
      content: "",
      createdAt: now,
      updatedAt: now,
      author: { ...event.orchestrator, type: "orchestrator" },
      reactions: [],
      replies: { count: 0 },
      poll: null,
      clientState: { streamKey: stream.streamKey, state: "pending" },
    }];
  }
  if (event.type === "token") {
    return messages.map((message) => message.clientState?.streamKey === stream.streamKey && message.author.key === event.orchestratorKey
      ? { ...message, content: message.content + event.text }
      : message);
  }
  if (event.type === "start") {
    return messages.map((message) => message.key === stream.userKey
      ? { ...message, ...event.userMessage, clientState: { streamKey: stream.streamKey, state: "reconciling" } }
      : message);
  }
  if (event.type === "done") {
    return messages.map((message) => message.clientState?.streamKey === stream.streamKey && message.author.key === event.orchestratorKey
      ? { ...message, ...event.message, clientState: { streamKey: stream.streamKey, state: "reconciling" } }
      : message);
  }
  if (event.type === "assistant-error") return messages.filter((message) => !(message.clientState?.streamKey === stream.streamKey && message.author.key === event.orchestratorKey));
  if (event.type === "complete") return messages;
  return markChorusStreamFailed(messages, stream.streamKey, event.error);
}

export function coalesceChorusStreamEvents(events: ChorusStreamEvent[]): ChorusStreamEvent[] {
  const coalesced: ChorusStreamEvent[] = [];
  for (const event of events) {
    const previous = coalesced.at(-1);
    if (event.type === "token" && previous?.type === "token" && previous.orchestratorKey === event.orchestratorKey) {
      coalesced[coalesced.length - 1] = { type: "token", orchestratorKey: event.orchestratorKey, text: previous.text + event.text };
    } else {
      coalesced.push(event);
    }
  }
  return coalesced;
}

export function setChorusReactionState(messages: ChorusMessage[], messageKey: string, reaction: string, active: boolean): ChorusMessage[] {
  return messages.map((message) => {
    if (message.key !== messageKey) return message;
    const existing = message.reactions.find((item) => item.reaction === reaction);
    if (existing?.viewerReacted === active || (!existing && !active)) return message;
    const reactions = existing
      ? message.reactions
        .map((item) => item.reaction === reaction ? { ...item, count: item.count + (active ? 1 : -1), viewerReacted: active } : item)
        .filter((item) => item.count > 0)
      : [...message.reactions, { reaction, count: 1, viewerReacted: true }];
    return { ...message, reactions };
  });
}

export function mergeChorusMessageRefresh(current: ChorusDisplayMessage[], canonical: ChorusMessage[], preserveTransient: boolean, preserveActions = false): ChorusDisplayMessage[] {
  const currentByKey = preserveActions ? new Map(current.map((message) => [message.key, message])) : null;
  const refreshed = currentByKey ? canonical.map((message) => {
    const existing = currentByKey.get(message.key);
    return existing ? { ...message, reactions: existing.reactions, replies: existing.replies, poll: existing.poll } : message;
  }) : canonical;
  if (!preserveTransient) return refreshed;
  const canonicalKeys = new Set(canonical.map((message) => message.key));
  return [...refreshed, ...current.filter((message) => message.clientState && !canonicalKeys.has(message.key))];
}

export function markChorusStreamFailed(messages: ChorusDisplayMessage[], streamKey: string, error: string): ChorusDisplayMessage[] {
  return messages.map((message) => message.clientState?.streamKey === streamKey
    ? { ...message, clientState: { streamKey, state: "failed", error } }
    : message);
}

export class ChorusRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ChorusRequestError";
  }
}

const base = (organizationKey: string) => `/api/founders/organizations/${encodeURIComponent(organizationKey)}/chorus`;

async function request<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const text = await response.text();
  let payload: unknown;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    throw new ChorusRequestError(chorusErrorMessage(payload, response.status), response.status);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ChorusRequestError("Chorus returned an invalid response", 502);
  return parsed.data;
}

function chorusErrorMessage(payload: unknown, status: number): string {
  const parsed = z.object({ error: z.union([z.string(), z.object({ message: z.string() }).passthrough()]) }).passthrough().safeParse(payload);
  return parsed.success ? typeof parsed.data.error === "string" ? parsed.data.error : parsed.data.error.message : `Chorus request failed (${status})`;
}

export async function listChorusChannels(organizationKey: string, signal?: AbortSignal) {
  const result = await request(`${base(organizationKey)}/channels`, z.object({ channels: z.array(chorusChannelSchema).length(1), mentionRoster: chorusMentionRosterSchema }).strict(), { signal });
  const channel = result.channels[0]!;
  return {
    channels: [chorusChannelEntrySchema.parse({ orchestrator: { key: "general", name: "General", role: "Organization channel" }, scopeKey: channel.scopeKey, canChat: true, channel })],
    mentionRoster: result.mentionRoster,
    mentions: [...result.mentionRoster.orchestrators, result.mentionRoster.everyone, ...result.mentionRoster.members],
  };
}

export async function publishChorusTyping(organizationKey: string, channelKey: string, active: boolean): Promise<void> {
  await request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/typing`, z.object({ ok: z.literal(true) }).strict(), { method: "POST", body: JSON.stringify({ active }) });
}

export function subscribeChorusTyping(organizationKey: string, channelKey: string, onEvent: (event: ChorusTypingEvent) => void): () => void {
  const source = new EventSource(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/typing`);
  source.addEventListener("typing", (message) => {
    try {
      const parsed = chorusTypingEventSchema.safeParse(JSON.parse((message as MessageEvent).data));
      if (parsed.success) onEvent(parsed.data);
    } catch {}
  });
  return () => source.close();
}

export async function transcribeChorusAudio(organizationKey: string, audioBase64: string, signal?: AbortSignal): Promise<string> {
  return (await request(`${base(organizationKey)}/transcriptions`, z.object({ text: z.string().trim().min(1) }).strict(), { method: "POST", body: JSON.stringify({ audioBase64, mimeType: "audio/pcm" }), signal })).text;
}

export async function synthesizeChorusSpeech(organizationKey: string, text: string, signal?: AbortSignal): Promise<string> {
  const result = await request(`${base(organizationKey)}/speech`, z.object({ audioBase64: z.string().min(1), mimeType: z.literal("audio/wav") }).strict(), { method: "POST", body: JSON.stringify({ text }), signal });
  const binary = atob(result.audioBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
}

export async function listChorusMessages(organizationKey: string, channelKey: string, signal?: AbortSignal) {
  return (await request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/messages?limit=200`, z.object({ messages: z.array(chorusMessageSchema) }).strict(), { signal })).messages;
}

export async function clearChorusChannel(organizationKey: string, channelKey: string) {
  return request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/messages`, z.object({ cleared: z.number().int().nonnegative() }).strict(), { method: "DELETE" });
}

export function deleteChorusMessage(organizationKey: string, channelKey: string, messageKey: string) {
  return request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/messages/${encodeURIComponent(messageKey)}`, z.object({ deleted: z.literal(true) }).strict(), { method: "DELETE" });
}

export function plainChorusText(content: string): string {
  return content
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/(?:\*\*|__)(.*?)(?:\*\*|__)/g, "$1")
    .replace(/(?:\*|_)(.*?)(?:\*|_)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function mutateChorusReaction(organizationKey: string, channelKey: string, messageKey: string, reaction: string, operation: "add" | "remove" | "toggle" = "toggle") {
  return request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/messages/${encodeURIComponent(messageKey)}/reactions`, z.object({ active: z.boolean() }).strict(), { method: "POST", body: JSON.stringify({ reaction, operation }) });
}

export async function listChorusFrequentReactions(organizationKey: string, signal?: AbortSignal) {
  return (await request(`${base(organizationKey)}/reactions`, z.object({ reactions: z.array(z.object({ reaction: z.string().trim().min(1).max(64), count: z.number().int().positive() }).strict()).max(10) }).strict(), { signal })).reactions;
}

export async function readChorusReplies(organizationKey: string, channelKey: string, messageKey: string, signal?: AbortSignal) {
  return request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/messages/${encodeURIComponent(messageKey)}/replies`, z.object({ parentMessageKey: keySchema, messages: z.array(chorusMessageSchema) }).strict(), { signal });
}

export async function createChorusPoll(organizationKey: string, channelKey: string, messageKey: string, question: string, options: string[], allowMultiple: boolean) {
  return (await request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/polls`, z.object({ poll: chorusPollSchema }).strict(), { method: "POST", body: JSON.stringify({ messageKey, question, options, allowMultiple }) })).poll;
}

export async function readChorusPoll(organizationKey: string, channelKey: string, pollKey: string, signal?: AbortSignal) {
  return (await request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/polls/${encodeURIComponent(pollKey)}`, z.object({ poll: chorusPollSchema }).strict(), { signal })).poll;
}

export async function voteChorusPoll(organizationKey: string, channelKey: string, pollKey: string, optionKey: string) {
  return (await request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/polls/${encodeURIComponent(pollKey)}/votes`, z.object({ poll: chorusPollSchema }).strict(), { method: "POST", body: JSON.stringify({ optionKey }) })).poll;
}

export async function closeChorusPoll(organizationKey: string, channelKey: string, pollKey: string) {
  return (await request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/polls/${encodeURIComponent(pollKey)}/close`, z.object({ poll: chorusPollSchema }).strict(), { method: "POST", body: "{}" })).poll;
}

export function parseChorusSseFrame(frame: string): ChorusStreamEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.replaceAll("\r\n", "\n").split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length || !["start", "assistant-start", "assistant-error", "token", "done", "complete", "error"].includes(event)) return null;
  let payload: unknown;
  try { payload = JSON.parse(data.join("\n")); } catch { throw new Error(`Malformed Chorus ${event} event`); }
  const parsed = chorusStreamEventSchema.safeParse({ type: event, ...(payload as object) });
  if (!parsed.success) throw new Error(`Malformed Chorus ${event} event`);
  return parsed.data;
}

export async function streamChorusMessage(organizationKey: string, channelKey: string, content: string, onEvent: (event: ChorusStreamEvent) => void, signal?: AbortSignal, threadKey?: string, replyToMessageKey?: string) {
  const response = await fetch(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/messages`, {
    method: "POST",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ content, ...(threadKey ? { threadKey } : {}), ...(replyToMessageKey ? { replyToMessageKey } : {}) }),
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ChorusRequestError(chorusErrorMessage(payload, response.status), response.status);
  }
  if (!response.body) throw new Error("Chorus stream unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = false;
  try {
    while (true) {
      const chunk = await reader.read();
      buffer = (buffer + decoder.decode(chunk.value, { stream: !chunk.done })).replaceAll("\r\n", "\n");
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const parsed = parseChorusSseFrame(frame);
        if (!parsed) continue;
        onEvent(parsed);
        if (parsed.type === "error") throw new Error(parsed.error);
        if (parsed.type === "complete") complete = true;
      }
      if (chunk.done) break;
    }
    if (buffer.trim()) {
      const parsed = parseChorusSseFrame(buffer);
      if (parsed) {
        onEvent(parsed);
        if (parsed.type === "error") throw new Error(parsed.error);
        if (parsed.type === "complete") complete = true;
      }
    }
    if (!complete) throw new Error("Chorus stream ended unexpectedly");
  } finally {
    reader.releaseLock();
  }
}
