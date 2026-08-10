import { z } from 'zod';
import { extractionResultSchema, type ExtractedBlock, type ExtractionResult } from './schemas';

const documentStringSchema = z.string().max(10_000_000).refine((value) => !value.includes('\0'), 'Document content cannot contain null bytes.');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const normalizedText = (value = '') => value.replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

function extractedBlockHtml(block: ExtractedBlock): string {
  const text = typeof block.attrs?.html === 'string' ? block.attrs.html : escapeHtml(normalizedText(block.text));
  switch (block.type) {
    case 'heading': return `<h${block.level ?? 1}>${text}</h${block.level ?? 1}>`;
    case 'paragraph': return `<p>${text}</p>`;
    case 'blockquote': return `<blockquote><p>${text}</p></blockquote>`;
    case 'codeBlock': return `<pre><code>${escapeHtml(block.text ?? '')}</code></pre>`;
    case 'horizontalRule': return '<hr>';
    case 'bulletList': return `<ul>${(block.children ?? []).map(extractedBlockHtml).join('')}</ul>`;
    case 'orderedList': return `<ol>${(block.children ?? []).map(extractedBlockHtml).join('')}</ol>`;
    case 'listItem': return `<li>${text}${(block.children ?? []).map(extractedBlockHtml).join('')}</li>`;
    case 'table': return `<table><tbody>${(block.children ?? []).map(extractedBlockHtml).join('')}</tbody></table>`;
    case 'tableRow': return `<tr>${(block.children ?? []).map(extractedBlockHtml).join('')}</tr>`;
    case 'tableCell': return `<td>${text}${(block.children ?? []).map(extractedBlockHtml).join('')}</td>`;
  }
}

export function extractionResultToHtml(input: ExtractionResult): string {
  return extractionResultSchema.parse(input).blocks.map(extractedBlockHtml).join('');
}

export function plainContentToHtml(input: string): string {
  const content = normalizedText(documentStringSchema.parse(input));
  return content ? content.split(/\n{2,}/).map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join('') : '';
}

type HtmlNode = { tag: string; attrs: Record<string, string>; children: Array<HtmlNode | string> };
const VOID_TAGS = new Set(['br', 'hr', 'img', 'col']);
const HTML_VOID_TAGS = new Set([...VOID_TAGS, 'area', 'base', 'col', 'embed', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ALLOWED_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'caption', 'colgroup', 'col', 'tbody', 'thead', 'tr', 'td', 'th', 'br', 'hr', 'img', 'section', 'figure', 'figcaption']);
const TRANSPARENT_TAGS = new Set(['article', 'main', 'header', 'footer', 'div', 'span']);
const DANGEROUS_TAGS = new Set(['script', 'style', 'iframe', 'object', 'svg']);
const BLOCK_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'pre', 'table', 'section', 'figure', 'figcaption']);
const decodeHtml = (value: string) => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]!);

function parseDocumentHtml(input: string): HtmlNode {
  const html = documentStringSchema.parse(input);
  const safe = html.replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const root: HtmlNode = { tag: 'root', attrs: {}, children: [] };
  const stack = [root];
  for (const token of safe.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (!token.startsWith('<')) { stack.at(-1)!.children.push(decodeHtml(token)); continue; }
    if (/^<\s*!/.test(token)) continue;
    const closing = /^<\s*\/\s*([a-z0-9]+)\s*>$/i.exec(token);
    if (closing) {
      const sourceTag = closing[1]!.toLowerCase();
      if (HTML_VOID_TAGS.has(sourceTag)) continue;
      if (stack.length === 1 || stack.at(-1)!.tag !== sourceTag) throw new Error(`Malformed HTML near closing ${sourceTag}.`);
      stack.pop();
      continue;
    }
    const opening = /^<\s*([a-z0-9]+)([^>]*)>$/i.exec(token);
    if (!opening) throw new Error('Malformed HTML.');
    const sourceTag = opening[1]!.toLowerCase();
    const attrs: Record<string, string> = {};
    for (const match of opening[2]!.matchAll(/([a-z][a-z0-9-]*)\s*=\s*["']([^"']*)["']/gi)) attrs[match[1]!.toLowerCase()] = decodeHtml(match[2]!);
    const node: HtmlNode = { tag: sourceTag, attrs, children: [] };
    stack.at(-1)!.children.push(node);
    if (!HTML_VOID_TAGS.has(sourceTag) && !/\/\s*>$/.test(token)) stack.push(node);
  }
  if (stack.length !== 1) throw new Error('Malformed HTML contains unclosed elements.');
  return root;
}

function serializeNode(node: HtmlNode | string): string {
  if (typeof node === 'string') return escapeHtml(node);
  if (node.tag === 'root') return node.children.filter((child) => typeof child !== 'string' || child.trim()).map(serializeNode).join('');
  if (DANGEROUS_TAGS.has(node.tag)) return '';
  if (TRANSPARENT_TAGS.has(node.tag)) return node.children.filter((child) => typeof child !== 'string' || child.trim()).map(serializeNode).join('');
  if (!ALLOWED_TAGS.has(node.tag)) return node.children.filter((child) => typeof child !== 'string' || child.trim()).map(serializeNode).join('');
  const positiveSpan = (value: string | undefined) => /^\d{1,2}$/.test(value ?? '') && Number(value) > 0 ? value : undefined;
  const attrs = node.tag === 'a' && /^https?:\/\//i.test(node.attrs.href ?? '')
    ? ` href="${escapeHtml(node.attrs.href!)}"${['_blank', '_self'].includes(node.attrs.target ?? '') ? ` target="${node.attrs.target}"` : ''}`
    : node.tag === 'img' && /^\/(?!\/)/.test(node.attrs.src ?? '')
      ? ` src="${escapeHtml(node.attrs.src!)}"${node.attrs.alt ? ` alt="${escapeHtml(node.attrs.alt)}"` : ''}${node.attrs.title ? ` title="${escapeHtml(node.attrs.title)}"` : ''}`
      : node.tag === 'section' && node.attrs.class === 'doc-page' && /^\d{1,5}$/.test(node.attrs['data-page'] ?? '')
        ? ` class="doc-page" data-page="${node.attrs['data-page']}"`
        : node.tag === 'td' || node.tag === 'th'
          ? `${positiveSpan(node.attrs.colspan) ? ` colspan="${node.attrs.colspan}"` : ''}${positiveSpan(node.attrs.rowspan) ? ` rowspan="${node.attrs.rowspan}"` : ''}`
          : node.tag === 'ol' && positiveSpan(node.attrs.start)
            ? ` start="${node.attrs.start}"`
            : '';
  const tag = node.tag === 'b' ? 'strong' : node.tag === 'i' ? 'em' : node.tag;
  if (VOID_TAGS.has(node.tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${node.children.map(serializeNode).join('')}</${tag}>`;
}

function treeText(node: HtmlNode | string, preserveWhitespace = false): string {
  if (typeof node === 'string') return preserveWhitespace ? node : node.replace(/\s+/g, ' ');
  if (node.tag === 'br') return '\n';
  if (node.tag === 'hr') return '\n---\n';
  if (node.tag === 'img') return node.attrs.alt ?? '';
  if (node.tag === 'tr') return `${node.children.map((child) => treeText(child).trim()).filter(Boolean).join('\t')}\n`;
  if (node.tag === 'td' || node.tag === 'th') return node.children.map((child) => treeText(child, preserveWhitespace)).join('');
  if (node.tag === 'li') return `${node.children.map((child) => treeText(child, preserveWhitespace)).join('').trim()}\n`;
  const value = node.children.map((child) => treeText(child, preserveWhitespace || node.tag === 'pre')).join('');
  if (node.tag === 'ul' || node.tag === 'ol') return `${value.trimEnd()}\n\n`;
  return BLOCK_TAGS.has(node.tag) ? `${value}\n\n` : value;
}

export function sanitizeDocumentHtml(input: string): string {
  return serializeNode(parseDocumentHtml(input));
}

export function htmlToPlainText(input: string): string {
  return treeText(parseDocumentHtml(input)).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function canonicalDocumentRepresentations(input: string): { html: string; content: string } {
  const html = sanitizeDocumentHtml(input);
  return { html, content: htmlToPlainText(html) };
}

function directText(node: HtmlNode): string {
  return node.children.filter((child) => typeof child === 'string' || !['ul', 'ol'].includes(child.tag)).map((child) => treeText(child)).join('').replace(/\s+/g, ' ').trim();
}

function extracted(node: HtmlNode): ExtractedBlock[] {
  const inlineHtml = () => node.children.map(serializeNode).join('');
  if (/^h[1-6]$/.test(node.tag)) return [{ type: 'heading', level: Number(node.tag[1]), text: directText(node), attrs: { html: inlineHtml() } }];
  if (node.tag === 'p') return [{ type: 'paragraph', text: directText(node), attrs: { html: inlineHtml() } }];
  if (node.tag === 'blockquote') return [{ type: 'blockquote', text: treeText(node).trim() }];
  if (node.tag === 'pre') return [{ type: 'codeBlock', text: treeText(node, true).trimEnd() }];
  if (node.tag === 'hr') return [{ type: 'horizontalRule' }];
  if (node.tag === 'ul' || node.tag === 'ol') return [{ type: node.tag === 'ul' ? 'bulletList' : 'orderedList', children: node.children.flatMap((child) => typeof child === 'string' ? [] : extracted(child)) }];
  if (node.tag === 'li') return [{ type: 'listItem', text: directText(node), attrs: { html: inlineHtml() }, children: node.children.filter((child): child is HtmlNode => typeof child !== 'string' && ['ul', 'ol'].includes(child.tag)).flatMap(extracted) }];
  if (node.tag === 'table') return [{ type: 'table', children: node.children.flatMap((child) => typeof child === 'string' ? [] : extracted(child)) }];
  if (node.tag === 'tbody' || node.tag === 'thead') return node.children.flatMap((child) => typeof child === 'string' ? [] : extracted(child));
  if (node.tag === 'tr') return [{ type: 'tableRow', children: node.children.flatMap((child) => typeof child === 'string' ? [] : extracted(child)) }];
  if (node.tag === 'td' || node.tag === 'th') return [{ type: 'tableCell', text: treeText(node).trim(), attrs: { html: inlineHtml() } }];
  return node.children.flatMap((child) => typeof child === 'string' ? [] : extracted(child));
}

export function htmlToExtractedBlocks(input: string): ExtractedBlock[] {
  return parseDocumentHtml(input).children.flatMap((child) => typeof child === 'string' ? [] : extracted(child));
}

const escapeMarkdown = (value: string) => value.replace(/([\\`*_[\]<>])/g, '\\$1');
function inlineMarkdown(node: HtmlNode | string): string {
  if (typeof node === 'string') return escapeMarkdown(node.replace(/\s+/g, ' '));
  const value = node.children.map(inlineMarkdown).join('');
  if (node.tag === 'br') return '\n';
  if (node.tag === 'strong' || node.tag === 'b') return `**${value}**`;
  if (node.tag === 'em' || node.tag === 'i') return `_${value}_`;
  if (node.tag === 'a' && /^https?:\/\//i.test(node.attrs.href ?? '')) return `[${value}](${node.attrs.href})`;
  return value;
}

function markdown(node: HtmlNode, depth = 0): string {
  if (node.tag === 'root') return node.children.map((child) => typeof child === 'string' ? '' : markdown(child, depth)).filter(Boolean).join('\n\n');
  if (/^h[1-6]$/.test(node.tag)) return `${'#'.repeat(Number(node.tag[1]))} ${inlineMarkdown(node)}`;
  if (node.tag === 'p') return inlineMarkdown(node);
  if (node.tag === 'blockquote') return node.children.map((child) => typeof child === 'string' ? escapeMarkdown(child) : markdown(child, depth)).join('\n').split('\n').map((line) => `> ${line}`).join('\n');
  if (node.tag === 'pre') return `\`\`\`\n${treeText(node, true).trimEnd()}\n\`\`\``;
  if (node.tag === 'hr') return '---';
  if (node.tag === 'ul' || node.tag === 'ol') return node.children.filter((child): child is HtmlNode => typeof child !== 'string' && child.tag === 'li').map((child, index) => `${'  '.repeat(depth)}${node.tag === 'ul' ? '-' : `${index + 1}.`} ${markdown(child, depth)}`).join('\n');
  if (node.tag === 'li') {
    const initial = inlineMarkdown({ ...node, children: node.children.filter((child) => typeof child === 'string' || !['ul', 'ol'].includes(child.tag)) }).trim();
    const nested = node.children.filter((child): child is HtmlNode => typeof child !== 'string' && ['ul', 'ol'].includes(child.tag)).map((child) => markdown(child, depth + 1));
    return [initial, ...nested].filter(Boolean).join('\n');
  }
  if (node.tag === 'table') {
    const rows = node.children.flatMap((child) => typeof child === 'string' ? [] : ['tbody', 'thead'].includes(child.tag) ? child.children.filter((row): row is HtmlNode => typeof row !== 'string' && row.tag === 'tr') : child.tag === 'tr' ? [child] : []);
    if (!rows.length) return '';
    const columns = rows[0]!.children.filter((child) => typeof child !== 'string').length || 1;
    return [markdown(rows[0]!), `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`, ...rows.slice(1).map(markdown)].join('\n');
  }
  if (node.tag === 'tr') return `| ${node.children.filter((child): child is HtmlNode => typeof child !== 'string').map((child) => markdown(child).replace(/\|/g, '\\|')).join(' | ')} |`;
  if (node.tag === 'td' || node.tag === 'th') return inlineMarkdown(node).trim();
  return node.children.map((child) => typeof child === 'string' ? escapeMarkdown(child) : markdown(child, depth)).join('');
}

export function htmlToMarkdown(input: string): string {
  return markdown(parseDocumentHtml(input)).trim();
}

export type DocumentHtmlInput = ExtractionResult | { html: string } | { content: string };
const documentHtmlInputSchema = z.union([
  extractionResultSchema,
  z.object({ html: documentStringSchema }).strict(),
  z.object({ content: documentStringSchema }).strict(),
]);

export function documentInputToHtml(input: DocumentHtmlInput): string {
  const parsed = documentHtmlInputSchema.parse(input);
  if ('html' in parsed) return parsed.html;
  return 'content' in parsed ? plainContentToHtml(parsed.content) : parsed.extractedHtml ?? extractionResultToHtml(parsed);
}
