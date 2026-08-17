import { expect, test } from 'bun:test';
import { generateDocumentPreview } from './preview';

const bytes = (value: string) => new TextEncoder().encode(value);
const html = async (result: Promise<{ bytes: Uint8Array }>) => new TextDecoder().decode((await result).bytes);

test('renders text and Markdown as sandbox-ready HTML', async () => {
  const text = await html(generateDocumentPreview({ extension: 'txt', bytes: bytes('<script>alert(1)</script>\nOriginal') }));
  expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(text).toContain('<pre>');
  expect(text).toContain("default-src 'none'");

  const markdown = await html(generateDocumentPreview({ extension: 'md', bytes: bytes('# Heading\n\n**Bold** [bad](javascript:alert(1))') }));
  expect(markdown).toContain('<h1>Heading</h1>');
  expect(markdown).toContain('<strong>Bold</strong>');
  expect(markdown).not.toContain('javascript:');
});

test('preserves safe Word formatting and strips executable markup', async () => {
  const docx = await html(generateDocumentPreview({ extension: 'docx', bytes: bytes('docx') }, {
    convertDocx: async () => '<h1>Report</h1><p><strong>Formatted</strong></p><script>alert(1)</script>',
  }));
  expect(docx).toContain('<h1>Report</h1>');
  expect(docx).toContain('<strong>Formatted</strong>');
  expect(docx).not.toContain('<script>');

  const doc = await html(generateDocumentPreview({ extension: 'doc', bytes: bytes('doc') }, {
    extractDoc: async () => 'First paragraph\ncontinued\n\nSecond paragraph',
  }));
  expect(doc).toContain('<p>First paragraph<br />continued</p>');
  expect(doc).toContain('<p>Second paragraph</p>');
});
