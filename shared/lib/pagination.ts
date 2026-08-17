export type CursorPage<T> = { items: T[]; nextCursor: string | null };

export function appendCursorItems<T>(current: readonly T[], page: readonly T[], key: (item: T) => string): T[] {
  const items = new Map(current.map((item) => [key(item), item]));
  for (const item of page) items.set(key(item), item);
  return [...items.values()];
}

export function isNearScrollEnd(input: { offset: number; viewport: number; content: number }, threshold = 240) {
  return input.offset + input.viewport >= input.content - threshold;
}
