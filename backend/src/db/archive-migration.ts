export interface LegacyVersionRepresentations {
  html: string;
  json: { type: 'doc'; content: Array<{ type: 'paragraph'; content?: Array<{ type: 'text'; text: string }> }> };
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** Produces a conservative editor snapshot from the version's own extracted text. */
export function legacyContentRepresentations(content: string): LegacyVersionRepresentations {
  if (content.trim().length === 0) throw new Error('Legacy document version content must not be blank.');
  const paragraphs = content.split(/\r?\n\r?\n/).map((text) => text.trim()).filter(Boolean);
  return {
    html: paragraphs.map((text) => `<p>${escapeHtml(text).replaceAll(/\r?\n/g, '<br>')}</p>`).join(''),
    json: {
      type: 'doc',
      content: paragraphs.map((text) => ({ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] })),
    },
  };
}

export function stageLegacyDocumentShares(shares: Array<Record<string, unknown>>) {
  const hashes = new Set<string>();
  return shares.map((share) => {
    const existingHash = typeof share.tokenHash === 'string' && share.tokenHash.length > 0 ? share.tokenHash : null;
    const token = typeof share.token === 'string' && share.token.length > 0 ? share.token : null;
    const tokenHash = existingHash && /^[a-f0-9]{64}$/i.test(existingHash)
      ? existingHash.toLowerCase()
      : token ? createHash('sha256').update(token).digest('hex') : null;
    if (!tokenHash) throw new Error(`Cannot migrate documentShares: ${String(share._key)} has neither a valid tokenHash nor a plaintext token.`);
    if (hashes.has(tokenHash)) throw new Error(`Cannot migrate documentShares: duplicate token hash ${tokenHash}.`);
    hashes.add(tokenHash);
    return {
      _key: share._key,
      tokenHash,
      permission: share.permission === 'comment' || share.permission === 'edit' ? 'comment' : 'read',
      embedding: [],
    };
  });
}
import { createHash } from 'node:crypto';
