const listeners = new Set<() => void>();

export function publishBookChanged() {
  for (const listener of listeners) listener();
}

export function subscribeBookChanged(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
