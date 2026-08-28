import { EventEmitter } from 'node:events';
import { redisConnection } from '@/lib/redis';

const CHANNEL = 'book-share:changed';
const EVENT = 'changed';
const bus = new EventEmitter();
bus.setMaxListeners(0);
const subscriber = redisConnection.duplicate();
let started = false;

subscriber.on('message', (_channel, tokenHash) => bus.emit(EVENT, tokenHash));
subscriber.on('error', (error) => console.warn('book share subscriber error', error instanceof Error ? error.message : String(error)));

function start() {
  if (started) return;
  started = true;
  subscriber.subscribe(CHANNEL).catch((error) => {
    started = false;
    console.warn('book share subscribe failed', error instanceof Error ? error.message : String(error));
  });
}

export async function publishBookShareChanged(tokenHash: string) {
  try { await redisConnection.publish(CHANNEL, tokenHash); }
  catch (error) {
    bus.emit(EVENT, tokenHash);
    console.warn('book share publish failed', error instanceof Error ? error.message : String(error));
  }
}

export function subscribeBookShareChanged(tokenHash: string, listener: () => void) {
  start();
  const receive = (changedHash: string) => { if (changedHash === tokenHash) listener(); };
  bus.on(EVENT, receive);
  return () => { bus.off(EVENT, receive); };
}
