import { describe, expect, test } from 'bun:test';
import { ACTION_HANDLERS } from './index';
import { write_post } from './write_post';
import { render_slideshow } from './render_slideshow';

describe('content post actions', () => {
  test('normalizes a single post into one text unit', async () => {
    const draft = await write_post({ platform: 'linkedin', title: 'Launch', body: 'We shipped the thing.' });

    expect(draft).toEqual({
      type: 'post_draft',
      platform: 'linkedin',
      format: 'single',
      texts: ['Launch\n\nWe shipped the thing.'],
      posts: [{ index: 0, title: 'Launch', body: 'We shipped the thing.', text: 'Launch\n\nWe shipped the thing.' }],
    });
  });

  test('detects multi-post arrays and renders them as ordered slides', async () => {
    const draft = await write_post({
      platform: 'instagram',
      posts: [
        { caption: 'Slide one hook' },
        { caption: 'Slide two proof' },
        { caption: 'Slide three CTA' },
      ],
    });
    const render = await render_slideshow(draft);

    expect(draft.format).toBe('multi');
    expect(draft.texts).toEqual(['Slide one hook', 'Slide two proof', 'Slide three CTA']);
    expect(render.slide_count).toBe(3);
    expect(render.slides.map((slide) => slide.text)).toEqual(draft.texts);
  });

  test('registers write and render actions for task creation', () => {
    expect(ACTION_HANDLERS.ACTION_WRITE_POST).toBe(write_post);
    expect(ACTION_HANDLERS.ACTION_RENDER_SLIDESHOW).toBe(render_slideshow);
  });
});
