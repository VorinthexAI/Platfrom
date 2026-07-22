import { describe, expect, test } from 'bun:test';
import mammoth from 'mammoth';
import {
  documentGenerateHtml,
  editorDocumentJsonToDocx,
  editorDocumentJsonToMarkdown,
  generateDocumentExport,
  htmlToEditorDocumentJson,
  type EditorDocumentJson,
} from '.';

const quiet = () => undefined;
const decoder = new TextDecoder();
const json: EditorDocumentJson = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Safe <Title>' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }, { type: 'text', text: ' body' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] }] },
  ],
};

function zipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50;) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.set(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)), bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

describe('canonical document representations', () => {
  test('document-generate-html accepts extraction, editor JSON, and normalized content', async () => {
    const extraction = await documentGenerateHtml({ extractedText: 'A', blocks: [{ type: 'paragraph', text: '<script>A</script>' }] }, { logger: quiet });
    const editor = await documentGenerateHtml({ json }, { logger: quiet });
    const content = await documentGenerateHtml({ content: ' First  line\r\n\r\n<script>bad</script> ' }, { logger: quiet });
    expect(extraction.html).toBe('<p>&lt;script&gt;A&lt;/script&gt;</p>');
    expect(editor.html).toContain('<h2>Safe &lt;Title&gt;</h2>');
    expect(editor.html).toContain('<strong>Bold</strong>');
    expect(content.html).toBe('<p>First line</p><p>&lt;script&gt;bad&lt;/script&gt;</p>');
  });

  test('HTML conversion strips active content and unsafe links deterministically', () => {
    const input = '<section><p onclick="bad()"><a href="https://example.com" target="_blank">safe</a> <a href="javascript:bad">bad</a></p><script>stolen()</script><iframe src="https://bad.example">hidden</iframe></section>';
    const first = htmlToEditorDocumentJson(input);
    const second = htmlToEditorDocumentJson(input);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toContain('https://example.com');
    expect(JSON.stringify(first)).not.toMatch(/javascript|onclick|stolen|hidden|iframe/);
  });

  test('renders real Markdown structure and marks', () => {
    expect(editorDocumentJsonToMarkdown(json)).toBe('## Safe \\<Title\\>\n\n**Bold** body\n\n- One');
  });
});

describe('derived document exports', () => {
  test('returns deterministic text export metadata and sanitized bytes', async () => {
    const first = await generateDocumentExport({ format: 'html', html: '<p>Safe</p><script>bad()</script>' });
    const second = await generateDocumentExport({ format: 'html', html: '<p>Safe</p><script>bad()</script>' });
    expect(first).toEqual(second);
    expect(first.mimeType).toBe('text/html; charset=utf-8');
    expect(first.extension).toBe('html');
    expect(decoder.decode(first.bytes)).toBe('<p>Safe</p>');
  });

  test('injects the PDF renderer with a locked-down sanitized HTML shell', async () => {
    let rendered = '';
    const pdf = new TextEncoder().encode('%PDF-1.7 injected');
    const result = await generateDocumentExport(
      { format: 'pdf', html: '<h1>Report</h1><img src="https://tracking.example/x"><script>bad()</script>' },
      { pdfRenderer: async (html) => { rendered = html; return pdf; } },
    );
    expect(result.bytes).toEqual(pdf);
    expect(result.mimeType).toBe('application/pdf');
    expect(rendered).toContain("default-src 'none'");
    expect(rendered).toContain('<h1>Report</h1>');
    expect(rendered).not.toMatch(/tracking\.example|bad\(\)|<script/);
  });

  test('generates a deterministic valid minimal DOCX ZIP with escaped document XML', async () => {
    const direct = editorDocumentJsonToDocx(json);
    const exported = await generateDocumentExport({ format: 'docx', json });
    expect(exported.bytes).toEqual(direct);
    expect(Array.from(direct.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Array.from(direct.slice(-22, -18))).toEqual([0x50, 0x4b, 0x05, 0x06]);
    const entries = zipEntries(direct);
    expect([...entries.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
    const documentXml = decoder.decode(entries.get('word/document.xml'));
    expect(documentXml).toContain('Safe &lt;Title&gt;');
    expect(documentXml).toContain('<w:outlineLvl w:val="1"/>');
    expect(documentXml).toContain('One');
    const parsed = await mammoth.convertToHtml({ buffer: Buffer.from(direct) });
    expect(parsed.value).toContain('Safe &lt;Title&gt;');
    expect(parsed.value).toContain('One');
  });

  test('rejects ambiguous or invalid source representations', async () => {
    await expect(generateDocumentExport({ format: 'txt', html: '<p>x</p>', content: 'x' })).rejects.toThrow('Exactly one');
    await expect(generateDocumentExport({ format: 'html', json: { type: 'paragraph' } as EditorDocumentJson })).rejects.toThrow();
  });
});
