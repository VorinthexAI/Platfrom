import { z } from "zod";

import type { AgentGreetingOccasion } from "@/state/ui";
import * as apiTransport from "./api-client";
import { conversationContextSchema, guideTopicSchema, type ConversationContext, type GuideTopic } from "./conversation-client";
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
  z.strictObject({ type: z.literal("done"), correlationKey: correlationKeySchema, messageKey: messageKeySchema, message: z.string().trim().min(1).max(500), showReferralCodeAction: z.boolean(), topicsPending: z.boolean(), persistenceToken: persistenceTokenSchema }),
  errorEventSchema,
]);
export type AgentGreetingEvent = z.infer<typeof agentGreetingEventSchema>;
export type AgentGreetingDone = Extract<AgentGreetingEvent, { type: "done" }>;

const uniqueTopicsSchema = z.array(guideTopicSchema).length(3).refine((topics) => new Set(topics.map(({ key }) => key)).size === topics.length
  && new Set(topics.map(({ label }) => label.toLocaleLowerCase())).size === topics.length
  && new Set(topics.map(({ question }) => question.toLocaleLowerCase())).size === topics.length,
"Guide topic keys, labels, and questions must be unique.");

export const agentGreetingTopicEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("topic"), correlationKey: correlationKeySchema, topic: guideTopicSchema }),
  z.strictObject({ type: z.literal("done"), correlationKey: correlationKeySchema, topics: uniqueTopicsSchema, persistenceToken: persistenceTokenSchema }),
  errorEventSchema,
]);
export type AgentGreetingTopicEvent = z.infer<typeof agentGreetingTopicEventSchema>;
export type AgentGreetingTopicsDone = Extract<AgentGreetingTopicEvent, { type: "done" }>;
export type AgentGreetingEventTransport = (path: string, body: unknown, onEvent: (event: ServerSentEvent) => void, signal?: AbortSignal) => Promise<void>;

function selectors(context: ConversationContext) {
  const { teamKey, scopeKey } = conversationContextSchema.parse(context);
  return { teamKey, scopeKey };
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
  const body = z.strictObject({ teamKey: z.string().min(1), scopeKey: z.string().min(1), occasion: z.enum(["onboarding", "returning"]) }).parse({ ...selectors(context), occasion });
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

function sameTopic(first: GuideTopic, second: GuideTopic) {
  return first.key === second.key && first.label === second.label && first.question === second.question;
}

export async function requestAgentGreetingTopicsWithTransport(transport: AgentGreetingEventTransport, context: ConversationContext, persistenceToken: string, onTopic: (event: Extract<AgentGreetingTopicEvent, { type: "topic" }>) => void, signal?: AbortSignal): Promise<AgentGreetingTopicsDone> {
  const body = z.strictObject({ teamKey: z.string().min(1), scopeKey: z.string().min(1), persistenceToken: persistenceTokenSchema }).parse({ ...selectors(context), persistenceToken });
  let correlationKey: string | undefined;
  let terminal: Extract<AgentGreetingTopicEvent, { type: "done" | "error" }> | undefined;
  const topics: GuideTopic[] = [];
  await transport("/agent/greeting/topics", body, (frame) => {
    if (terminal) throw new Error("Agent greeting topic stream emitted after its terminal event.");
    const event = parseStreamEvent(frame, ["topic", "done", "error"], agentGreetingTopicEventSchema);
    if (correlationKey && event.correlationKey !== correlationKey) throw new Error("Agent greeting topic stream event did not match the active request.");
    correlationKey ??= event.correlationKey;
    if (event.type === "topic") {
      if (topics.length >= 3) throw new Error("Agent greeting topic stream emitted more than three topics.");
      const foldedLabel = event.topic.label.toLocaleLowerCase();
      const foldedQuestion = event.topic.question.toLocaleLowerCase();
      if (topics.some((topic) => topic.key === event.topic.key || topic.label.toLocaleLowerCase() === foldedLabel || topic.question.toLocaleLowerCase() === foldedQuestion)) throw new Error("Agent greeting topic stream emitted a duplicate topic.");
      topics.push(event.topic);
      onTopic(event);
    } else {
      if (event.type === "done" && (topics.length !== event.topics.length || topics.some((topic, index) => !sameTopic(topic, event.topics[index]!)))) throw new Error("Agent greeting topic completion did not exactly match its streamed topics.");
      terminal = event;
    }
  }, signal);
  if (!terminal) throw new Error("Agent greeting topic stream ended before a terminal event.");
  if (terminal.type === "error") throw terminalError(terminal);
  return terminal;
}

export function requestAgentGreetingTopics(context: ConversationContext, persistenceToken: string, onTopic: (event: Extract<AgentGreetingTopicEvent, { type: "topic" }>) => void, signal?: AbortSignal) {
  return requestAgentGreetingTopicsWithTransport(apiTransport.postEventStream, context, persistenceToken, onTopic, signal);
}
