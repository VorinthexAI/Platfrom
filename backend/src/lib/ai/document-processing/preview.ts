import mammoth from 'mammoth';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import WordExtractor from 'word-extractor';
import { z } from 'zod';

const previewInputSchema = z.object({
  extension: z.enum(['txt', 'md', 'doc', 'docx']),
  bytes: z.instanceof(Uint8Array),
}).strict();

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function safeBody(value: string) {
  return sanitizeHtml(value, {
    allowedTags: ['a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'],
    allowedAttributes: { a: ['href'], img: ['alt', 'height', 'src', 'width'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
  });
}

function page(body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { box-sizing: border-box; max-width: 850px; min-height: 100vh; margin: 0 auto; padding: 40px 44px 72px; color: #202124; background: #fff; font-size: 16px; line-height: 1.55; overflow-wrap: anywhere; }
    h1,h2,h3,h4,h5,h6 { line-height: 1.2; margin: 1.4em 0 .6em; } p,blockquote,pre,table,ul,ol { margin: 0 0 1em; } pre { white-space: pre-wrap; font: inherit; }
    table { width: 100%; border-collapse: collapse; } th,td { padding: 8px 10px; border: 1px solid #cfd3d8; text-align: left; vertical-align: top; } img { max-width: 100%; height: auto; }
    a { color: #315efb; } blockquote { margin-left: 0; padding-left: 16px; border-left: 3px solid #cfd3d8; color: #555; }
    @media (prefers-color-scheme: dark) { body { color: #eceff3; background: #161719; } th,td { border-color: #40444a; } blockquote { border-color: #50545a; color: #b7bbc2; } }
  </style></head><body>${safeBody(body)}</body></html>`;
}

export async function generateDocumentPreview(input: { extension: 'txt' | 'md' | 'doc' | 'docx'; bytes: Uint8Array }, options: {
  convertDocx?: (bytes: Uint8Array) => Promise<string>;
  extractDoc?: (bytes: Uint8Array) => Promise<string>;
} = {}) {
  const parsed = previewInputSchema.parse(input);
  if (parsed.extension === 'txt') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(parsed.bytes);
    return { bytes: new TextEncoder().encode(page(`<pre>${escapeHtml(text)}</pre>`)), mimeType: 'text/html; charset=utf-8', extension: 'html' as const };
  }
  if (parsed.extension === 'md') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(parsed.bytes);
    return { bytes: new TextEncoder().encode(page(marked.parse(text, { async: false, gfm: true }) as string)), mimeType: 'text/html; charset=utf-8', extension: 'html' as const };
  }
  if (parsed.extension === 'docx') {
    const html = options.convertDocx ? await options.convertDocx(parsed.bytes) : (await mammoth.convertToHtml({ buffer: Buffer.from(parsed.bytes) })).value;
    return { bytes: new TextEncoder().encode(page(html)), mimeType: 'text/html; charset=utf-8', extension: 'html' as const };
  }
  const text = options.extractDoc ? await options.extractDoc(parsed.bytes) : (await new WordExtractor().extract(Buffer.from(parsed.bytes))).getBody();
  const body = text.trim().split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
  return { bytes: new TextEncoder().encode(page(body)), mimeType: 'text/html; charset=utf-8', extension: 'html' as const };
}
