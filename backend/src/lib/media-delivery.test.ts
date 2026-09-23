import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, verify } from 'node:crypto';
import { signMediaDownloadUrl } from './media-delivery';

describe('private CDN download URLs', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

  test('signs the exact encoded object path and expiration for CloudFront', () => {
    const url = new URL(signMediaDownloadUrl('media/owner/a photo*.png', { domain: 'd123.cloudfront.net', keyPairId: 'KTEST123', privateKey, now: () => 1_000_000 }));
    expect(url.pathname).toBe('/media/owner/a%20photo%2A.png');
    expect(url.searchParams.get('Expires')).toBe('1900');
    expect(url.searchParams.get('Hash-Algorithm')).toBe('SHA256');
    const signature = url.searchParams.get('Signature')!.replaceAll('-', '+').replaceAll('_', '=').replaceAll('~', '/');
    const resource = `${url.origin}${url.pathname}`;
    const policy = JSON.stringify({ Statement: [{ Resource: resource, Condition: { DateLessThan: { 'AWS:EpochTime': 1900 } } }] });
    expect(verify('RSA-SHA256', Buffer.from(policy), publicKey, Buffer.from(signature, 'base64'))).toBe(true);
    expect(verify('RSA-SHA256', Buffer.from(policy.replace('owner', 'other')), publicKey, Buffer.from(signature, 'base64'))).toBe(false);
  });

  test('rejects traversal and malformed delivery configuration', () => {
    expect(() => signMediaDownloadUrl('media/../secret', { domain: 'd123.cloudfront.net', keyPairId: 'KTEST123', privateKey })).toThrow();
    expect(() => signMediaDownloadUrl('media/photo.png', { domain: 'bad.example/path', keyPairId: 'KTEST123', privateKey })).toThrow();
  });
});
