import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { z } from 'zod';
import {
  editorDocumentJsonToMarkdown,
  editorDocumentJsonToHtml,
  editorDocumentJsonToPlainText,
  htmlToEditorDocumentJson,
  plainContentToHtml,
  sanitizeDocumentHtml,
} from './representation';
import { editorDocumentJsonSchema, type EditorDocumentJson } from './schemas';

export const documentExportFormatSchema = z.enum(['html', 'txt', 'md', 'pdf', 'docx']);
export type DocumentExportFormat = z.infer<typeof documentExportFormatSchema>;
export type PdfRenderer = (safeHtmlDocument: string) => Promise<Uint8Array>;
export type DocumentExportInput = {
  format: DocumentExportFormat;
  html?: string;
  json?: EditorDocumentJson;
  content?: string;
};

export interface DocumentExportResult {
  bytes: Uint8Array;
  mimeType: string;
  extension: DocumentExportFormat;
}

const documentExportInputSchema = z.object({
  format: documentExportFormatSchema,
  html: z.string().max(10_000_000).optional(),
  json: editorDocumentJsonSchema.optional(),
  content: z.string().max(10_000_000).optional(),
}).strict().superRefine((input, context) => {
  const sources = Number(input.html !== undefined) + Number(input.json !== undefined) + Number(input.content !== undefined);
  if (sources !== 1) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one of html, json, or content is required for document export.' });
});

const MIME_TYPES: Record<DocumentExportFormat, string> = {
  html: 'text/html; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const textEncoder = new TextEncoder();
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);

function canonicalJson(input: DocumentExportInput): EditorDocumentJson {
  const sources = Number(input.html !== undefined) + Number(input.json !== undefined) + Number(input.content !== undefined);
  if (sources !== 1) throw new Error('Exactly one of html, json, or content is required for document export.');
  if (input.json !== undefined) return editorDocumentJsonSchema.parse(input.json);
  if (input.html !== undefined) return htmlToEditorDocumentJson(input.html);
  return htmlToEditorDocumentJson(plainContentToHtml(z.string().max(10_000_000).parse(input.content)));
}

export function createSafeHtmlDocument(bodyHtml: string): string {
  const body = sanitizeDocumentHtml(bodyHtml);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>@page{margin:20mm}body{font:12pt/1.5 Arial,sans-serif;color:#111;overflow-wrap:anywhere}h1,h2,h3,h4,h5,h6{break-after:avoid}pre{white-space:pre-wrap}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;padding:4px}</style></head><body>${body}</body></html>`;
}

export async function renderPdfWithChromium(safeHtmlDocument: string, timeoutMs = 30_000): Promise<Uint8Array> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  const timeout = <T>(promise: Promise<T>, label: string): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
  try {
    browser = await timeout(puppeteer.launch({
      args: [...chromium.args, '--disable-background-networking', '--disable-default-apps', '--disable-sync'],
      defaultViewport: { width: 1_280, height: 960 },
      executablePath: await chromium.executablePath(),
      headless: true,
      timeout: timeoutMs,
    }), 'PDF browser launch');
    const page = await timeout(browser.newPage(), 'PDF page creation');
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url === 'about:blank' || url.startsWith('data:')) void request.continue();
      else void request.abort('blockedbyclient');
    });
    await timeout(page.setContent(safeHtmlDocument, { waitUntil: 'domcontentloaded', timeout: timeoutMs }), 'PDF HTML rendering');
    const pdf = await timeout(page.pdf({ format: 'A4', printBackground: true, timeout: timeoutMs }), 'PDF generation');
    return new Uint8Array(pdf);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function zip(entries: Array<{ name: string; content: string }>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = textEncoder.encode(entry.name);
    const data = textEncoder.encode(entry.content);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(12, 0x21, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(14, 0x21, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length;
  }
  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return concatBytes([...localParts, ...centralParts, end]);
}

function nodePlainText(node: EditorDocumentJson): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(nodePlainText).join('');
}

function documentXml(json: EditorDocumentJson): string {
  const paragraphs: string[] = [];
  const addParagraph = (text: string, properties = '') => {
    const runs = text.split('\n').map((line, index) => `${index ? '<w:r><w:br/></w:r>' : ''}<w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`).join('');
    paragraphs.push(`<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${runs || '<w:r><w:t/></w:r>'}</w:p>`);
  };
  const visit = (node: EditorDocumentJson, listPrefix?: string) => {
    if (node.type === 'heading') addParagraph(nodePlainText(node), `<w:outlineLvl w:val="${Number(node.attrs?.level) - 1}"/>`);
    else if (node.type === 'paragraph') addParagraph(`${listPrefix ?? ''}${nodePlainText(node)}`);
    else if (node.type === 'codeBlock') addParagraph(nodePlainText(node));
    else if (node.type === 'horizontalRule') addParagraph('---');
    else if (node.type === 'listItem') {
      const [first, ...nested] = node.content ?? [];
      if (first) visit(first, listPrefix ?? '\u2022 ');
      nested.forEach((child) => visit(child));
    } else if (node.type === 'orderedList') (node.content ?? []).forEach((child, index) => visit(child, `${index + 1}. `));
    else if (node.type === 'bulletList') (node.content ?? []).forEach((child) => visit(child, '\u2022 '));
    else if (node.type === 'tableRow') addParagraph((node.content ?? []).map(nodePlainText).join('\t'));
    else (node.content ?? []).forEach((child) => visit(child));
  };
  visit(json);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
}

export function editorDocumentJsonToDocx(input: EditorDocumentJson): Uint8Array {
  const json = editorDocumentJsonSchema.parse(input);
  return zip([
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', content: documentXml(json) },
  ]);
}

export async function generateDocumentExport(input: DocumentExportInput, options: { pdfRenderer?: PdfRenderer } = {}): Promise<DocumentExportResult> {
  const parsed = documentExportInputSchema.parse(input);
  const format = parsed.format;
  const json = canonicalJson(parsed);
  const html = sanitizeDocumentHtml(parsed.html ?? (parsed.content !== undefined ? plainContentToHtml(parsed.content) : editorDocumentJsonToHtml(json)));
  let bytes: Uint8Array;
  if (format === 'html') bytes = textEncoder.encode(html);
  else if (format === 'txt') bytes = textEncoder.encode(editorDocumentJsonToPlainText(json));
  else if (format === 'md') bytes = textEncoder.encode(editorDocumentJsonToMarkdown(json));
  else if (format === 'docx') bytes = editorDocumentJsonToDocx(json);
  else {
    bytes = await (options.pdfRenderer ?? renderPdfWithChromium)(createSafeHtmlDocument(html));
    if (!(bytes instanceof Uint8Array) || decoderPrefix(bytes, 5) !== '%PDF-') throw new Error('PDF renderer returned invalid PDF bytes.');
  }
  return { bytes, mimeType: MIME_TYPES[format], extension: format };
}

function decoderPrefix(bytes: Uint8Array, length: number): string {
  return new TextDecoder('ascii').decode(bytes.subarray(0, length));
}
