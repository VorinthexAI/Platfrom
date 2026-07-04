import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXECUTION_TARGET, render_post, renderPostInputSchema } from './render-post';

const sharedRoot = process.env.SHARED_DIR ?? resolve(process.cwd(), '..', 'shared');

describe('ACTION_RENDER_POST', () => {
  test('declares render execution target', () => {
    expect(EXECUTION_TARGET).toBe('render');
  });

  test('rejects square video before rendering work begins', async () => {
    const result = await render_post({
      postId: 'post_test',
      slides: [{ backgroundImageKey: 'images/input.png', title: 'Title', imageAlt: 'Alt' }],
      variants: [{ orientation: 'square', format: 'video' }],
    });

    expect(result.status).toBe('failed');
    expect(result.results).toEqual([
      { orientation: 'square', format: 'video', error: 'Invalid render variant: video is only supported for portrait orientation.' },
    ]);
  });

  test('uses split orientation and format variants, not legacy flat strings', () => {
    const parsed = renderPostInputSchema.safeParse({
      postId: 'post_test',
      slides: [{ backgroundImageKey: 'images/input.png', title: 'Title', imageAlt: 'Alt' }],
      variants: ['square_png'],
    });

    expect(parsed.success).toBe(false);
  });

  test('all post layouts include optional empty-safe overlay token', () => {
    const layouts = [
      'brand/posts/single/square/default-layout.html',
      'brand/posts/single/portrait/default-layout.html',
      'brand/posts/multi/square/default-layout.html',
      'brand/posts/multi/portrait/default-layout.html',
    ];

    for (const layout of layouts) {
      const html = readFileSync(resolve(sharedRoot, layout), 'utf8');
      expect(html).toContain('{{overlay_text}}');
      expect(html).toContain('.post-overlay:empty');
      expect(html).not.toContain('box-shadow');
    }
  });
});
