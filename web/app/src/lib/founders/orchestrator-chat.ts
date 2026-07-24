import { z } from "zod";

const tokenSchema = z.object({ text: z.string() }).strict();
const errorSchema = z.object({ error: z.string().trim().min(1) }).strict();

export type OrchestratorChatEvent =
  | { type: "start" }
  | { type: "token"; text: string }
  | { type: "done" }
  | { type: "error"; error: string };

export interface OrchestratorChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  failed?: boolean;
}

export type OrchestratorChatThreads = Record<string, OrchestratorChatMessage[]>;

export function appendThreadMessages(
  threads: OrchestratorChatThreads,
  orchestratorSlug: string,
  ...messages: OrchestratorChatMessage[]
): OrchestratorChatThreads {
  return { ...threads, [orchestratorSlug]: [...(threads[orchestratorSlug] ?? []), ...messages] };
}

export function updateThreadMessage(
  threads: OrchestratorChatThreads,
  orchestratorSlug: string,
  messageId: string,
  update: (message: OrchestratorChatMessage) => OrchestratorChatMessage,
): OrchestratorChatThreads {
  return {
    ...threads,
    [orchestratorSlug]: (threads[orchestratorSlug] ?? []).map((message) => message.id === messageId ? update(message) : message),
  };
}

export function parseOrchestratorChatFrame(frame: string): OrchestratorChatEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.replaceAll("\r\n", "\n").split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  const payload = data.join("\n");
  if (event === "start") return { type: "start" };
  if (event === "token") return { type: "token", ...tokenSchema.parse(JSON.parse(payload)) };
  if (event === "done") return { type: "done" };
  if (event === "error") return { type: "error", ...errorSchema.parse(JSON.parse(payload)) };
  return null;
}

export async function streamOrchestratorChat(
  orchestratorSlug: string,
  message: string,
  onEvent: (event: OrchestratorChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/orchestrators/chat?${new URLSearchParams({ orchestrator_slug: orchestratorSlug })}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `Chat request failed (${response.status})`);
  }
  if (!response.body) throw new Error("Chat stream unavailable");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneReceived = false;
  while (true) {
    const result = await reader.read();
    buffer = (buffer + decoder.decode(result.value, { stream: !result.done })).replaceAll("\r\n", "\n");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = parseOrchestratorChatFrame(frame);
      if (!event) continue;
      onEvent(event);
      if (event.type === "error") throw new Error(event.error);
      if (event.type === "done") doneReceived = true;
    }
    if (result.done) break;
  }
  if (buffer.trim()) {
    const event = parseOrchestratorChatFrame(buffer);
    if (event) {
      onEvent(event);
      if (event.type === "error") throw new Error(event.error);
      if (event.type === "done") doneReceived = true;
    }
  }
  if (!doneReceived) throw new Error("Chat stream ended unexpectedly");
}
