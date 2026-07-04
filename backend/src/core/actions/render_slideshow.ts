import { z } from 'zod';
import { normalizePostDraft, postDraftSchema } from './content-posts';

export const renderSlideshowInputSchema = z.unknown();

export async function render_slideshow(input: z.infer<typeof renderSlideshowInputSchema>) {
  const draft = postDraftSchema.safeParse(input).success ? postDraftSchema.parse(input) : normalizePostDraft(input);
  return {
    type: 'slideshow_render',
    platform: draft.platform,
    slide_count: draft.texts.length,
    slides: draft.texts.map((text, index) => ({
      index,
      text,
      source_post_index: draft.posts[index]?.index ?? index,
    })),
    source: draft,
  };
}
