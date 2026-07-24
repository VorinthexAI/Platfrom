import { z } from "zod";

const keySchema = z.string().trim().min(1).max(160);
const isoTimestampSchema = z.string().datetime({ offset: true });

export const chorusChannelSchema = z.object({
  key: keySchema,
  scopeKey: keySchema,
  kind: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  position: z.number().int(),
  directOrchestratorKey: keySchema.optional(),
  archivedAt: isoTimestampSchema.optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
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
  threadKey: keySchema.optional(),
  replyToMessageKey: keySchema.optional(),
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
  thread: z.object({ key: keySchema, status: z.enum(["open", "resolved", "archived"]), replyCount: z.number().int().nonnegative(), lastReplyAt: isoTimestampSchema.nullable() }).strict().nullable(),
  poll: chorusPollSchema.nullable(),
}).strict();

export const chorusThreadSchema = z.object({
  key: keySchema,
  channelKey: keySchema,
  title: z.string().trim().min(1).optional(),
  rootMessageKey: keySchema,
  status: z.enum(["open", "resolved", "archived"]),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
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
  z.object({ type: z.literal("token"), text: z.string() }).strict(),
  z.object({ type: z.literal("done"), message: chorusStreamMessageSchema }).strict(),
  z.object({ type: z.literal("error"), error: z.string().trim().min(1) }).strict(),
]);

export type ChorusChannel = z.infer<typeof chorusChannelSchema>;
export type ChorusChannelEntry = z.infer<typeof chorusChannelEntrySchema>;
export type ChorusMessage = z.infer<typeof chorusMessageSchema>;
export type ChorusThread = z.infer<typeof chorusThreadSchema>;
export type ChorusPoll = z.infer<typeof chorusPollSchema>;
export type ChorusStreamEvent = z.infer<typeof chorusStreamEventSchema>;
export type ChorusDisplayState = "optimistic" | "pending" | "reconciling" | "failed";
export type ChorusDisplayMessage = ChorusMessage & {
  clientState?: { streamKey: string; state: ChorusDisplayState; error?: string };
};

export interface ChorusOptimisticStream {
  streamKey: string;
  userKey: string;
  assistantKey: string;
}

export function reconcileChorusStreamEvent(messages: ChorusDisplayMessage[], stream: ChorusOptimisticStream, event: ChorusStreamEvent): ChorusDisplayMessage[] {
  if (event.type === "token") {
    return messages.map((message) => message.key === stream.assistantKey
      ? { ...message, content: message.content + event.text }
      : message);
  }
  if (event.type === "start") {
    return messages.map((message) => message.key === stream.userKey
      ? { ...message, ...event.userMessage, clientState: { streamKey: stream.streamKey, state: "reconciling" } }
      : message);
  }
  if (event.type === "done") {
    return messages.map((message) => message.key === stream.assistantKey
      ? { ...message, ...event.message, clientState: { streamKey: stream.streamKey, state: "reconciling" } }
      : message);
  }
  return markChorusStreamFailed(messages, stream.streamKey, event.error);
}

export function mergeChorusMessageRefresh(current: ChorusDisplayMessage[], canonical: ChorusMessage[], preserveTransient: boolean): ChorusDisplayMessage[] {
  if (!preserveTransient) return canonical;
  const canonicalKeys = new Set(canonical.map((message) => message.key));
  return [...canonical, ...current.filter((message) => message.clientState && !canonicalKeys.has(message.key))];
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
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const text = await response.text();
  let payload: unknown;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).passthrough().safeParse(payload);
    throw new ChorusRequestError(error.success ? error.data.error : `Chorus request failed (${response.status})`, response.status);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ChorusRequestError("Chorus returned an invalid response", 502);
  return parsed.data;
}

export async function listChorusChannels(organizationKey: string, signal?: AbortSignal) {
  return (await request(`${base(organizationKey)}/channels`, z.object({ channels: z.array(chorusChannelEntrySchema) }).strict(), { signal })).channels;
}

export async function openChorusChannel(organizationKey: string, orchestratorKey: string, signal?: AbortSignal) {
  return (await request(`${base(organizationKey)}/orchestrators/${encodeURIComponent(orchestratorKey)}/open`, z.object({ channel: chorusChannelSchema }).strict(), { method: "POST", body: "{}", signal })).channel;
}

export async function listChorusMessages(organizationKey: string, channelKey: string, signal?: AbortSignal) {
  return (await request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/messages?limit=200`, z.object({ messages: z.array(chorusMessageSchema) }).strict(), { signal })).messages;
}

export async function mutateChorusReaction(organizationKey: string, channelKey: string, messageKey: string, reaction: string, operation: "add" | "remove" | "toggle" = "toggle") {
  return request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/messages/${encodeURIComponent(messageKey)}/reactions`, z.object({ active: z.boolean() }).strict(), { method: "POST", body: JSON.stringify({ reaction, operation }) });
}

export async function createChorusThread(organizationKey: string, channelKey: string, rootMessageKey: string, title?: string, signal?: AbortSignal) {
  return (await request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/threads`, z.object({ thread: chorusThreadSchema }).strict(), { method: "POST", body: JSON.stringify({ rootMessageKey, ...(title ? { title } : {}) }), signal })).thread;
}

export async function readChorusThread(organizationKey: string, channelKey: string, threadKey: string, signal?: AbortSignal) {
  return request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/threads/${encodeURIComponent(threadKey)}`, z.object({ thread: chorusThreadSchema, messages: z.array(chorusMessageSchema) }).strict(), { signal });
}

export async function replyChorusThread(organizationKey: string, channelKey: string, threadKey: string, content: string, replyToMessageKey?: string, signal?: AbortSignal) {
  return request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/threads/${encodeURIComponent(threadKey)}/replies`, z.object({ message: chorusStreamMessageSchema }).strict(), { method: "POST", body: JSON.stringify({ content, ...(replyToMessageKey ? { replyToMessageKey } : {}) }), signal });
}

export async function resolveChorusThread(organizationKey: string, channelKey: string, threadKey: string, signal?: AbortSignal) {
  return (await request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/threads/${encodeURIComponent(threadKey)}/resolve`, z.object({ thread: chorusThreadSchema }).strict(), { method: "POST", body: "{}", signal })).thread;
}

export async function archiveChorusThread(organizationKey: string, channelKey: string, threadKey: string, signal?: AbortSignal) {
  return (await request(`${base(organizationKey)}/channels/${encodeURIComponent(channelKey)}/threads/${encodeURIComponent(threadKey)}/archive`, z.object({ thread: chorusThreadSchema }).strict(), { method: "POST", body: "{}", signal })).thread;
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
  if (!data.length || !["start", "token", "done", "error"].includes(event)) return null;
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
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new ChorusRequestError(typeof payload?.error === "string" ? payload.error : `Chorus request failed (${response.status})`, response.status);
  }
  if (!response.body) throw new Error("Chorus stream unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
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
        if (parsed.type === "done") done = true;
      }
      if (chunk.done) break;
    }
    if (buffer.trim()) {
      const parsed = parseChorusSseFrame(buffer);
      if (parsed) {
        onEvent(parsed);
        if (parsed.type === "error") throw new Error(parsed.error);
        if (parsed.type === "done") done = true;
      }
    }
    if (!done) throw new Error("Chorus stream ended unexpectedly");
  } finally {
    reader.releaseLock();
  }
}
