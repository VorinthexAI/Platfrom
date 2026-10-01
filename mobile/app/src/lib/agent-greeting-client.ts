import { z } from "zod";

import type { AgentGreetingOccasion } from "@/state/ui";
import * as apiTransport from "./api-client";
import { conversationContextSchema, type ConversationContext } from "./conversation-client";
import { observeDomainError } from "./domain-error-observer";
import type { ServerSentEvent } from "./sse";

const correlationKeySchema = z.string().trim().min(1).max(180);
const messageKeySchema = z.string().cuid();
const persistenceTokenSchema = z.string().min(1).max(20_000);
const errorEventSchema = z.strictObject({
  type: z.literal("error"),
  correlationKey: correlationKeySchema,
  code: z.string().trim().min(1).max(180),
  message: z.string().trim().min(1).max(1_000),
});

export const agentGreetingEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("delta"), correlationKey: correlationKeySchema, messageKey: messageKeySchema, text: z.string().min(1).max(500) }),
  z.strictObject({ type: z.literal("done"), correlationKey: correlationKeySchema, messageKey: messageKeySchema, message: z.string().trim().min(1).max(500), persistenceToken: persistenceTokenSchema }),
  errorEventSchema,
]);
export type AgentGreetingEvent = z.infer<typeof agentGreetingEventSchema>;
export type AgentGreetingDone = Extract<AgentGreetingEvent, { type: "done" }>;

export type AgentGreetingEventTransport = (path: string, body: unknown, onEvent: (event: ServerSentEvent) => void, signal?: AbortSignal) => Promise<void>;

function selectors(context: ConversationContext) {
  const { scopeKey } = conversationContextSchema.parse(context);
  return { scopeKey };
}

function parseStreamEvent<T>(frame: ServerSentEvent, eventNames: readonly string[], schema: z.ZodType<T>): T {
  if (!eventNames.includes(frame.event)) throw new Error(`Unknown agent greeting stream event: ${frame.event}.`);
  const event = schema.parse(JSON.parse(frame.data));
  if (typeof event !== "object" || event === null || !("type" in event) || event.type !== frame.event) throw new Error("Agent greeting stream event name did not match its payload type.");
  if (!("correlationKey" in event) || frame.id !== event.correlationKey) throw new Error("Agent greeting stream event id did not match its correlation key.");
  return event;
}

function terminalError(event: { code: string; message: string }) {
  return observeDomainError(Object.assign(new Error(event.message), { code: event.code }));
}

export async function requestAgentGreetingWithTransport(transport: AgentGreetingEventTransport, context: ConversationContext, occasion: AgentGreetingOccasion, onDelta: (event: Extract<AgentGreetingEvent, { type: "delta" }>) => void, signal?: AbortSignal): Promise<AgentGreetingDone> {
  const body = z.strictObject({ scopeKey: z.string().min(1), occasion: z.enum(["onboarding", "returning"]) }).parse({ ...selectors(context), occasion });
  let correlationKey: string | undefined;
  let messageKey: string | undefined;
  let terminal: Extract<AgentGreetingEvent, { type: "done" | "error" }> | undefined;
  await transport("/agent/greeting", body, (frame) => {
    if (terminal) throw new Error("Agent greeting stream emitted after its terminal event.");
    const event = parseStreamEvent(frame, ["delta", "done", "error"], agentGreetingEventSchema);
    if (correlationKey && event.correlationKey !== correlationKey) throw new Error("Agent greeting stream event did not match the active greeting.");
    correlationKey ??= event.correlationKey;
    if (event.type === "delta") {
      if (messageKey && event.messageKey !== messageKey) throw new Error("Agent greeting stream delta changed message key.");
      messageKey ??= event.messageKey;
      onDelta(event);
    } else {
      if (event.type === "done" && messageKey && event.messageKey !== messageKey) throw new Error("Agent greeting stream completion did not match its deltas.");
      terminal = event;
    }
  }, signal);
  if (!terminal) throw new Error("Agent greeting stream ended before a terminal event.");
  if (terminal.type === "error") throw terminalError(terminal);
  return terminal;
}

export function requestAgentGreeting(context: ConversationContext, occasion: AgentGreetingOccasion, onDelta: (event: Extract<AgentGreetingEvent, { type: "delta" }>) => void, signal?: AbortSignal) {
  return requestAgentGreetingWithTransport(apiTransport.postEventStream, context, occasion, onDelta, signal);
}
