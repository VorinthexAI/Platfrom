import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { redisConnection } from '@/lib/redis';

const TYPING_CHANNEL = 'communication:typing:v1';
const TYPING_EVENT = 'typing';

export const communicationTypingEventSchema = z.object({
  organizationKey: z.string().min(1),
  channelKey: z.string().min(1),
  participantKey: z.string().min(1),
  type: z.enum(['user', 'orchestrator']),
  name: z.string().trim().min(1).max(160),
  active: z.boolean(),
  expiresAt: z.number().int().nonnegative(),
}).strict();

export type CommunicationTypingEvent = z.infer<typeof communicationTypingEventSchema>;

const typingBus = new EventEmitter();
typingBus.setMaxListeners(0);
let subscriberStarted = false;

function ensureSubscriber() {
  if (subscriberStarted) return;
  subscriberStarted = true;
  const subscriber = redisConnection.duplicate();
  subscriber.on('error', (error) => console.warn('communication typing subscriber error', error instanceof Error ? error.message : String(error)));
  subscriber.subscribe(TYPING_CHANNEL).catch((error) => {
    console.warn('communication typing subscribe failed', error instanceof Error ? error.message : String(error));
    subscriberStarted = false;
  });
  subscriber.on('message', (_channel, message) => {
    try {
      const event = communicationTypingEventSchema.parse(JSON.parse(message));
      typingBus.emit(TYPING_EVENT, event);
    } catch {}
  });
}

export async function publishCommunicationTyping(event: CommunicationTypingEvent) {
  try {
    await redisConnection.publish(TYPING_CHANNEL, JSON.stringify(communicationTypingEventSchema.parse(event)));
  } catch (error) {
    console.warn('communication typing publish failed', error instanceof Error ? error.message : String(error));
  }
}

export function subscribeCommunicationTyping(listener: (event: CommunicationTypingEvent) => void) {
  ensureSubscriber();
  typingBus.on(TYPING_EVENT, listener);
  return () => typingBus.off(TYPING_EVENT, listener);
}
