import { createId } from '@paralleldrive/cuid2';

export function cuid(_prefix?: string) {
  return createId();
}

export function findGraphNodeBySlug<T extends { slug: string }>(nodes: Record<string, T>, slug: string) {
  return Object.entries(nodes).find(([, node]) => node.slug === slug);
}

export function nowIso() {
  return new Date().toISOString();
}

