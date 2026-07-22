import { z } from 'zod';
import {
  editorDocumentJsonSchema,
  extractionResultSchema,
  type EditorDocumentJson,
  type EditorNodeJson,
  type ExtractedBlock,
  type ExtractionResult,
} from './schemas';

const plainContentSchema = z.string().max(10_000_000).refine((value) => !value.includes('\0'), 'Document content cannot contain null bytes.');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const normalizedText = (value = '') => value.replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

function extractedBlockHtml(block: ExtractedBlock): string {
  const text = escapeHtml(normalizedText(block.text));
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

function editorInlineHtml(node: EditorNodeJson): string {
  let value = node.type === 'text' ? escapeHtml(node.text ?? '').replace(/\n/g, '<br>') : (node.content ?? []).map(editorInlineHtml).join('');
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') value = `<strong>${value}</strong>`;
    else if (mark.type === 'italic') value = `<em>${value}</em>`;
    else value = `<a href="${escapeHtml(mark.attrs.href)}"${mark.attrs.target ? ` target="${mark.attrs.target}"` : ''}>${value}</a>`;
  }
  return value;
}

function editorNodeHtml(node: EditorNodeJson): string {
  const inline = () => (node.content ?? []).map(editorInlineHtml).join('');
  const blocks = () => (node.content ?? []).map(editorNodeHtml).join('');
  switch (node.type) {
    case 'doc': return blocks();
    case 'heading': return `<h${Number(node.attrs?.level)}>${inline()}</h${Number(node.attrs?.level)}>`;
    case 'paragraph': return `<p>${inline()}</p>`;
    case 'text': return editorInlineHtml(node);
    case 'bulletList': return `<ul>${blocks()}</ul>`;
    case 'orderedList': return `<ol>${blocks()}</ol>`;
    case 'listItem': return `<li>${blocks()}</li>`;
    case 'blockquote': return `<blockquote>${blocks()}</blockquote>`;
    case 'codeBlock': return `<pre><code>${escapeHtml((node.content ?? []).map((child) => child.text ?? '').join(''))}</code></pre>`;
    case 'horizontalRule': return '<hr>';
    case 'table': return `<table><tbody>${blocks()}</tbody></table>`;
    case 'tableRow': return `<tr>${blocks()}</tr>`;
    case 'tableCell': return `<td>${blocks()}</td>`;
  }
}

export function extractionResultToHtml(input: ExtractionResult): string {
  return extractionResultSchema.parse(input).blocks.map(extractedBlockHtml).join('');
}

export function editorDocumentJsonToHtml(input: EditorDocumentJson): string {
  return editorNodeHtml(editorDocumentJsonSchema.parse(input));
}

export function plainContentToHtml(input: string): string {
  const content = normalizedText(plainContentSchema.parse(input));
  return content ? content.split(/\n{2,}/).map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join('') : '';
}

type HtmlTree = { tag: string; attrs: Record<string, string>; children: Array<HtmlTree | string> };
const VOID_TAGS = new Set(['br', 'hr']);
const ALLOWED_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'b', 'em', 'i', 'a', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'br', 'hr']);
const decodeHtml = (value: string) => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]!);

function parseHtml(htmlInput: string): HtmlTree {
  const html = plainContentSchema.parse(htmlInput);
  const safe = html.replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const root: HtmlTree = { tag: 'root', attrs: {}, children: [] };
  const stack = [root];
  for (const token of safe.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (!token.startsWith('<')) { stack.at(-1)!.children.push(decodeHtml(token)); continue; }
    if (/^<\s*!/.test(token)) continue;
    const closing = /^<\s*\/\s*([a-z0-9]+)\s*>$/i.exec(token);
    if (closing) {
      const tag = closing[1]!.toLowerCase();
      if (!ALLOWED_TAGS.has(tag) || VOID_TAGS.has(tag)) continue;
      if (stack.length === 1 || stack.at(-1)!.tag !== tag) throw new Error(`Malformed HTML near closing ${tag}.`);
      stack.pop();
      continue;
    }
    const opening = /^<\s*([a-z0-9]+)([^>]*)>$/i.exec(token);
    if (!opening) throw new Error('Malformed HTML.');
    const tag = opening[1]!.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    const attrs: Record<string, string> = {};
    for (const match of opening[2]!.matchAll(/([a-z][a-z0-9-]*)\s*=\s*["']([^"']*)["']/gi)) attrs[match[1]!.toLowerCase()] = decodeHtml(match[2]!);
    const node: HtmlTree = { tag, attrs, children: [] };
    stack.at(-1)!.children.push(node);
    if (!VOID_TAGS.has(tag) && !/\/\s*>$/.test(token)) stack.push(node);
  }
  if (stack.length !== 1) throw new Error('Malformed HTML contains unclosed elements.');
  return root;
}

type Mark = NonNullable<EditorNodeJson['marks']>[number];
function inlineNodes(children: Array<HtmlTree | string>, marks: Mark[] = []): EditorNodeJson[] {
  const output: EditorNodeJson[] = [];
  for (const child of children) {
    if (typeof child === 'string') {
      const text = child.replace(/\s+/g, ' ');
      if (text) output.push({ type: 'text', text, ...(marks.length ? { marks } : {}) });
      continue;
    }
    if (child.tag === 'br') { output.push({ type: 'text', text: '\n', ...(marks.length ? { marks } : {}) }); continue; }
    let nextMarks = marks;
    if (child.tag === 'strong' || child.tag === 'b') nextMarks = [...marks, { type: 'bold' }];
    if (child.tag === 'em' || child.tag === 'i') nextMarks = [...marks, { type: 'italic' }];
    if (child.tag === 'a' && /^https?:\/\//i.test(child.attrs.href ?? '')) nextMarks = [...marks, { type: 'link', attrs: { href: child.attrs.href!, ...(['_blank', '_self'].includes(child.attrs.target ?? '') ? { target: child.attrs.target as '_blank' | '_self' } : {}) } }];
    output.push(...inlineNodes(child.children, nextMarks));
  }
  return output;
}

function blockNode(node: HtmlTree): EditorNodeJson[] {
  if (/^h[1-6]$/.test(node.tag)) return [{ type: 'heading', attrs: { level: Number(node.tag[1]) }, content: inlineNodes(node.children) }];
  if (node.tag === 'p') return [{ type: 'paragraph', content: inlineNodes(node.children) }];
  if (node.tag === 'blockquote') return [{ type: 'blockquote', content: node.children.flatMap((child) => typeof child === 'string' ? [{ type: 'paragraph', content: inlineNodes([child]) } as EditorNodeJson] : blockNode(child)) }];
  if (node.tag === 'pre') return [{ type: 'codeBlock', content: [{ type: 'text', text: treeText(node, false) }] }];
  if (node.tag === 'hr') return [{ type: 'horizontalRule' }];
  if (node.tag === 'ul' || node.tag === 'ol') return [{ type: node.tag === 'ul' ? 'bulletList' : 'orderedList', content: node.children.flatMap((child) => typeof child === 'string' ? [] : blockNode(child)) }];
  if (node.tag === 'li') {
    const nested = node.children.filter((child): child is HtmlTree => typeof child !== 'string' && (child.tag === 'ul' || child.tag === 'ol')).flatMap(blockNode);
    const inline = node.children.filter((child) => typeof child === 'string' || !['ul', 'ol'].includes(child.tag));
    return [{ type: 'listItem', content: [{ type: 'paragraph', content: inlineNodes(inline) }, ...nested] }];
  }
  if (node.tag === 'table') return [{ type: 'table', content: node.children.flatMap((child) => typeof child === 'string' ? [] : blockNode(child)) }];
  if (node.tag === 'tbody' || node.tag === 'thead') return node.children.flatMap((child) => typeof child === 'string' ? [] : blockNode(child));
  if (node.tag === 'tr') return [{ type: 'tableRow', content: node.children.flatMap((child) => typeof child === 'string' ? [] : blockNode(child)) }];
  if (node.tag === 'td' || node.tag === 'th') return [{ type: 'tableCell', content: [{ type: 'paragraph', content: inlineNodes(node.children) }] }];
  return node.children.flatMap((child) => typeof child === 'string' ? [] : blockNode(child));
}

function treeText(node: HtmlTree, normalize = true): string {
  const value = node.children.map((child) => typeof child === 'string' ? child : treeText(child, normalize)).join('');
  return normalize ? value.replace(/\s+/g, ' ').trim() : value;
}

export function htmlToEditorDocumentJson(input: string): EditorDocumentJson {
  const root = parseHtml(input);
  return editorDocumentJsonSchema.parse({ type: 'doc', content: root.children.flatMap((child) => typeof child === 'string' ? [] : blockNode(child)) });
}

function editorNodeToExtracted(node: EditorNodeJson): ExtractedBlock[] {
  const text = nodeText(node).replace(/\n+/g, ' ').trim();
  if (node.type === 'heading') return [{ type: 'heading', level: Number(node.attrs?.level), text }];
  if (node.type === 'paragraph') return [{ type: 'paragraph', text }];
  if (node.type === 'blockquote') return [{ type: 'blockquote', text }];
  if (node.type === 'codeBlock') return [{ type: 'codeBlock', text: nodeText(node) }];
  if (node.type === 'horizontalRule') return [{ type: 'horizontalRule' }];
  if (node.type === 'bulletList' || node.type === 'orderedList') return [{ type: node.type, children: (node.content ?? []).flatMap(editorNodeToExtracted) }];
  if (node.type === 'listItem') return [{ type: 'listItem', text: node.content?.[0] ? nodeText(node.content[0]).replace(/\n+/g, ' ').trim() : '', children: (node.content ?? []).slice(1).flatMap(editorNodeToExtracted) }];
  if (node.type === 'table') return [{ type: 'table', children: (node.content ?? []).flatMap(editorNodeToExtracted) }];
  if (node.type === 'tableRow') return [{ type: 'tableRow', children: (node.content ?? []).flatMap(editorNodeToExtracted) }];
  if (node.type === 'tableCell') return [{ type: 'tableCell', text }];
  return (node.content ?? []).flatMap(editorNodeToExtracted);
}

export function htmlToExtractedBlocks(input: string): ExtractedBlock[] {
  return (htmlToEditorDocumentJson(input).content ?? []).flatMap(editorNodeToExtracted);
}

function nodeText(node: EditorNodeJson): string {
  if (node.type === 'text') return node.text ?? '';
  const children = (node.content ?? []).map(nodeText).filter(Boolean);
  if (node.type === 'tableRow') return children.join('\t');
  if (node.type === 'listItem') return `- ${children.join('\n')}`;
  return children.join(['doc', 'blockquote', 'table', 'bulletList', 'orderedList'].includes(node.type) ? '\n\n' : '');
}

export function editorDocumentJsonToPlainText(input: EditorDocumentJson): string {
  return nodeText(editorDocumentJsonSchema.parse(input)).replace(/\n{3,}/g, '\n\n').trim();
}

const escapeMarkdown = (value: string) => value.replace(/([\\`*_[\]<>])/g, '\\$1');
function inlineMarkdown(node: EditorNodeJson): string {
  let value = node.type === 'text' ? escapeMarkdown(node.text ?? '') : (node.content ?? []).map(inlineMarkdown).join('');
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') value = `**${value}**`;
    else if (mark.type === 'italic') value = `_${value}_`;
    else value = `[${value}](${mark.attrs.href})`;
  }
  return value;
}

function markdownBlocks(node: EditorNodeJson, depth = 0): string {
  const inline = () => (node.content ?? []).map(inlineMarkdown).join('');
  switch (node.type) {
    case 'doc': return (node.content ?? []).map((child) => markdownBlocks(child, depth)).filter(Boolean).join('\n\n');
    case 'heading': return `${'#'.repeat(Number(node.attrs?.level))} ${inline()}`;
    case 'paragraph': return inline();
    case 'text': return inlineMarkdown(node);
    case 'blockquote': return markdownBlocks({ type: 'doc', content: node.content }, depth).split('\n').map((line) => `> ${line}`).join('\n');
    case 'codeBlock': return `\`\`\`\n${(node.content ?? []).map((child) => child.text ?? '').join('')}\n\`\`\``;
    case 'horizontalRule': return '---';
    case 'bulletList':
    case 'orderedList': return (node.content ?? []).map((child, index) => `${'  '.repeat(depth)}${node.type === 'bulletList' ? '-' : `${index + 1}.`} ${markdownListItem(child, depth)}`).join('\n');
    case 'listItem': return markdownListItem(node, depth);
    case 'table': {
      const rows = node.content ?? [];
      if (rows.length === 0) return '';
      const columns = rows[0]!.content?.length ?? 1;
      return [markdownBlocks(rows[0]!, depth), `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`, ...rows.slice(1).map((child) => markdownBlocks(child, depth))].join('\n');
    }
    case 'tableRow': return `| ${(node.content ?? []).map((child) => markdownBlocks(child, depth).replace(/\|/g, '\\|')).join(' | ')} |`;
    case 'tableCell': return (node.content ?? []).map((child) => markdownBlocks(child, depth)).join(' ');
  }
}

function markdownListItem(node: EditorNodeJson, depth: number): string {
  const [first, ...rest] = node.content ?? [];
  const initial = first ? markdownBlocks(first, depth) : '';
  const nested = rest.map((child) => markdownBlocks(child, depth + 1)).filter(Boolean);
  return [initial, ...nested].join('\n');
}

export function editorDocumentJsonToMarkdown(input: EditorDocumentJson): string {
  return markdownBlocks(editorDocumentJsonSchema.parse(input)).trim();
}

export type DocumentHtmlInput = ExtractionResult | { json: EditorDocumentJson } | { content: string };
const documentHtmlInputSchema = z.union([
  extractionResultSchema,
  z.object({ json: editorDocumentJsonSchema }).strict(),
  z.object({ content: plainContentSchema }).strict(),
]);

export function documentInputToHtml(input: DocumentHtmlInput): string {
  const parsed = documentHtmlInputSchema.parse(input);
  if ('json' in parsed) return editorDocumentJsonToHtml(parsed.json);
  if ('content' in parsed) return plainContentToHtml(parsed.content);
  return extractionResultToHtml(parsed);
}

export function sanitizeDocumentHtml(input: string): string {
  return editorDocumentJsonToHtml(htmlToEditorDocumentJson(input));
}
