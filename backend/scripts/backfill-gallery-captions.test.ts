import { describe, expect, test } from 'bun:test';

describe('Gallery caption backfill safety', () => {
  test('is dry-run by default, account-targetable, revision-guarded, and non-destructive', async () => {
    const source = await Bun.file(new URL('./backfill-gallery-captions.ts', import.meta.url)).text();
    expect(source).toContain("process.argv.includes('--execute')");
    expect(source).toContain("argument.startsWith('--email=')");
    expect(source).toContain("process.argv.includes('--all')");
    expect(source).toContain('caption._rev == @revision');
    expect(source).toContain('computePerceptualHashBatch');
    expect(source).toContain('imageCaptionTool.execute');
    expect(source).toContain('scoreVersion: 1');
    expect(source).not.toMatch(/documentStorage\.(?:delete|upload|copy)/);
    expect(source).not.toContain('REMOVE ');
  });
});
