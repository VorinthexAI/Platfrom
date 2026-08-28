import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createBookService } from './service';

const organizationKey = 'organization';
const scopeKey = newId();
const userKey = newId();
const bookKey = newId();
const shareKey = newId();
const token = 'A'.repeat(43);
const tokenHash = createHash('sha256').update(token).digest('hex');
const createdAt = '2026-08-28T12:00:00.000Z';
const share = (active: boolean) => ({ key: shareKey, scopeKey, sourceType: 'book' as const, sourceKey: bookKey, permission: 'read' as const, tokenHash, responseCiphertext: 'v1:a:b:c', ...(active ? {} : { revokedAt: createdAt }), createdAt, updatedAt: createdAt });

describe('book sharing service', () => {
  test('returns a stable owner DTO without secrets and strictly updates active state', async () => {
    const calls: unknown[][] = []; let current = share(false);
    const repository: any = { shareDetail: async (...args: unknown[]) => { calls.push(['detail', ...args]); return current; }, setShareActive: async (...args: unknown[]) => { calls.push(['update', ...args]); current = share(true); return current; } };
    const service = createBookService({ repository, decryptShareReplay: () => ({ token }), now: () => createdAt, publishChanged: async (key) => { calls.push(['book.changed', key]); }, publishShareChanged: async (hash) => { calls.push(['share.changed', hash]); } });
    await expect(service.shareDetail(bookKey, { organizationKey, scopeKey }, userKey)).resolves.toEqual({ key: shareKey, url: `https://vorinthex.com/share/books/${token}`, active: false, createdAt, updatedAt: createdAt });
    await expect(service.setShareActive(bookKey, { organizationKey, scopeKey, active: true, forged: true }, userKey)).rejects.toThrow('Unrecognized key');
    const updated = await service.setShareActive(bookKey, { organizationKey, scopeKey, active: true }, userKey);
    expect(updated).toEqual({ key: shareKey, url: `https://vorinthex.com/share/books/${token}`, active: true, createdAt, updatedAt: createdAt });
    expect(JSON.stringify(updated)).not.toContain(tokenHash);
    expect(calls).toContainEqual(['book.changed', scopeKey]);
    expect(calls).toContainEqual(['share.changed', tokenHash]);
  });

  test('requires an active ready share and projects only safe playback fields with fresh URLs', async () => {
    let active = false; const signed: string[] = [];
    const repository: any = { publicShare: async (hash: string) => hash === tokenHash ? { share: share(active), book: { key: bookKey, title: 'Decisions', subtitle: 'A guide', description: 'Decide well', status: 'ready', narratorVoiceKey: 'clear', coverStorageKey: 'private/cover', estimatedMinutes: 5, chapterCount: 1, scopeKey, generationOwnerKey: userKey, generationInput: { secret: true } }, chapters: [{ key: newId(), scopeKey, bookKey, title: 'Start', description: 'Opening', content: 'Safe prose', position: 1, estimatedMinutes: 5, audioStorageKey: 'private/audio', imageStorageKey: 'private/image', audioDurationSeconds: 300, storageInternal: 'secret' }] } : null };
    const service = createBookService({ repository, publicSignUrl: async (key) => { signed.push(key); return `signed:${key}:${signed.length}`; } });
    await expect(service.readPublicShare(token)).rejects.toMatchObject({ reason: 'not_found' });
    active = true;
    const result = await service.readPublicShare(token);
    expect(result).toMatchObject({ book: { key: bookKey, status: 'ready', isFavorite: false, progressPercent: 0, coverUrl: 'signed:private/cover:1' }, chapters: [{ audioUrl: 'signed:private/audio:2', imageUrl: 'signed:private/image:3', progressSeconds: 0, isCompleted: false }] });
    expect(JSON.stringify(result)).not.toMatch(/scopeKey|generationOwnerKey|generationInput|storageKey|token|secret/);
    await service.readPublicShare(token);
    expect(signed).toHaveLength(6);
  });

  test('reports a non-ready shared book as inactive', async () => {
    const repository: any = { publicShare: async () => ({ share: share(true), book: { status: 'writing' }, chapters: [] }) };
    await expect(createBookService({ repository }).publicShareStatus(token)).resolves.toEqual({ tokenHash, active: false });
  });
});
