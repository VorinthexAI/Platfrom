import { createHash } from 'node:crypto';

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
    };
  });
}
