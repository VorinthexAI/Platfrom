/**
 * Tiny event bus for scene impact effects. Emitters (sun ejecta, meteor
 * strikes, random rock collisions) queue explosions; the ExplosionField
 * consumes the queue on its next frame. Plain module state — no React.
 */

export interface ExplosionRequest {
  position: [number, number, number];
  /** 1 = typical rock burst; bigger meteors push 2+. */
  strength: number;
}

const queue: ExplosionRequest[] = [];

export function queueExplosion(
  position: [number, number, number],
  strength = 1,
): void {
  // Cap the backlog — if nothing consumes (paused tab), don't grow forever.
  if (queue.length > 24) queue.shift();
  queue.push({ position, strength });
}

export function drainExplosions(): ExplosionRequest[] {
  if (queue.length === 0) return [];
  return queue.splice(0, queue.length);
}
