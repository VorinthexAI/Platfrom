import { z } from 'zod';

export const postUnitSchema = z.object({
  index: z.number().int().nonnegative(),
  title: z.string().optional(),
  body: z.string().optional(),
  caption: z.string().optional(),
  text: z.string(),
});

export const postDraftSchema = z.object({
  type: z.literal('post_draft'),
  platform: z.string(),
  format: z.enum(['single', 'multi']),
  texts: z.array(z.string()).min(1),
  posts: z.array(postUnitSchema).min(1),
});

export type PostDraft = z.infer<typeof postDraftSchema>;
type PostUnit = z.infer<typeof postUnitSchema>;

function valueToText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const parts = [
    typeof record.title === 'string' ? record.title : null,
    typeof record.body === 'string' ? record.body : null,
    typeof record.caption === 'string' ? record.caption : null,
    typeof record.text === 'string' ? record.text : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : null;
}

function postFromValue(value: unknown, index: number) {
  const text = valueToText(value);
  if (!text) return null;
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    index,
    title: typeof record.title === 'string' ? record.title : undefined,
    body: typeof record.body === 'string' ? record.body : undefined,
    caption: typeof record.caption === 'string' ? record.caption : undefined,
    text,
  };
}

function arrayFromInput(input: Record<string, unknown>) {
  for (const key of ['texts', 'posts', 'slides', 'items']) {
    const value = input[key];
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return null;
}

export function normalizePostDraft(input: unknown): PostDraft {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : { text: input };
  const platform = typeof record.platform === 'string' ? record.platform : 'generic';
  const arrayInput = arrayFromInput(record);
  const posts: PostUnit[] = arrayInput
    ? arrayInput.map(postFromValue).filter((post): post is NonNullable<ReturnType<typeof postFromValue>> => Boolean(post))
    : [postFromValue(record, 0)].filter((post): post is NonNullable<ReturnType<typeof postFromValue>> => Boolean(post));

  if (posts.length === 0) {
    const fallback = typeof record.prompt === 'string' ? record.prompt : JSON.stringify(input);
    posts.push({ index: 0, text: fallback });
  }

  return postDraftSchema.parse({
    type: 'post_draft',
    platform,
    format: posts.length > 1 ? 'multi' : 'single',
    texts: posts.map((post) => post.text),
    posts: posts.map((post, index) => ({ ...post, index })),
  });
}
