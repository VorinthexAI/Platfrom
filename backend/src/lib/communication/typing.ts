import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { redisConnection } from '@/lib/redis';

const TYPING_CHANNEL = 'chorus:typing:v1';
const TYPING_EVENT = 'typing';

export const chorusTypingEventSchema = z.object({
  organizationKey: z.string().min(1),
  channelKey: z.string().min(1),
  participantKey: z.string().min(1),
  type: z.enum(['user', 'orchestrator']),
  name: z.string().trim().min(1).max(160),
  active: z.boolean(),
  expiresAt: z.number().int().nonnegative(),
}).strict();

export type ChorusTypingEvent = z.infer<typeof chorusTypingEventSchema>;

const typingBus = new EventEmitter();
typingBus.setMaxListeners(0);
let subscriberStarted = false;

function ensureSubscriber() {
  if (subscriberStarted) return;
  subscriberStarted = true;
  const subscriber = redisConnection.duplicate();
  subscriber.on('error', (error) => console.warn('chorus typing subscriber error', error instanceof Error ? error.message : String(error)));
  subscriber.subscribe(TYPING_CHANNEL).catch((error) => {
    console.warn('chorus typing subscribe failed', error instanceof Error ? error.message : String(error));
    subscriberStarted = false;
  });
  subscriber.on('message', (_channel, message) => {
    try {
      const event = chorusTypingEventSchema.parse(JSON.parse(message));
      typingBus.emit(TYPING_EVENT, event);
    } catch {}
  });
}

export async function publishChorusTyping(event: ChorusTypingEvent) {
  try {
    await redisConnection.publish(TYPING_CHANNEL, JSON.stringify(chorusTypingEventSchema.parse(event)));
  } catch (error) {
    console.warn('chorus typing publish failed', error instanceof Error ? error.message : String(error));
  }
}

export function subscribeChorusTyping(listener: (event: ChorusTypingEvent) => void) {
  ensureSubscriber();
  typingBus.on(TYPING_EVENT, listener);
  return () => typingBus.off(TYPING_EVENT, listener);
}
