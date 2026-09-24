import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { completeDocumentUpload, documentUploadReserveSchema, reserveDocumentUpload } from './direct-upload';

const teamKey = newId(), scopeKey = newId(), folderKey = newId(), userKey = newId();
const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId(), teamKey, userId: userKey, status: 'active', teamRole: 'moderator' } } } as any;
const options = { authenticatedUserKey: userKey };
function fixture() {
  const values = new Map<string, string>();
  const stored = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const calls: any[] = [];
  let permitted = true;
  let fail = false;
  const redis = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && values.has(key)) return null;
      values.set(key, value); return 'OK';
    },
    eval: async (_script: string, _count: number, key: string, token: string) => { if (values.get(key) !== token) return 0; values.delete(key); return 1; },
  } as any;
  const storage = { download: async (key: string) => ({ bytes: stored.get(key)! }), delete: async (key: string) => { deleted.push(key); stored.delete(key); } } as any;
  const dependencies = {
    redis, storage,
    signUpload: async (key: string) => `https://example.test/${key}`,
    inspect: async (key: string) => stored.has(key) ? { sizeBytes: stored.get(key)!.byteLength, mimeType: 'text/plain' } : { sizeBytes: 0, mimeType: 'text/plain' },
    preflight: async () => { if (!permitted) throw new Error('revoked'); },
    run: async (input: unknown, runOptions: unknown) => { calls.push({ input, runOptions }); if (fail) throw new Error('processing failed'); return { document: { key: newId() } }; },
  } as any;
  const input = { teamKey, scopeKey, folderKey, idempotencyKey: 'attempt-1', kind: 'file' as const, files: [{ filename: 'note.txt', mimeType: 'text/plain', sizeBytes: 4 }] };
  return { input, dependencies, stored, deleted, calls, permit: (value: boolean) => { permitted = value; }, fail: (value: boolean) => { fail = value; } };
}

describe('direct document upload protocol', () => {
  test('rejects unknown fields and oversized scan sessions before signing', async () => {
    const f = fixture();
    expect(documentUploadReserveSchema.safeParse({ ...f.input, userKey }).success).toBe(false);
    expect(documentUploadReserveSchema.safeParse({ ...f.input, files: [{ ...f.input.files[0], token: 'x' }] }).success).toBe(false);
    await expect(reserveDocumentUpload({ ...f.input, kind: 'pages', files: Array.from({ length: 3 }, (_, index) => ({ filename: `page-${index}.png`, mimeType: 'image/png', sizeBytes: 8 * 1024 * 1024 })) }, context, f.dependencies)).rejects.toMatchObject({ code: 'DOCUMENT_TOO_LARGE' });
  });

  test('binds the reservation to the user, scope, destination and request key', async () => {
    const f = fixture();
    await expect(reserveDocumentUpload({ ...f.input, scopeKey: newId() }, context, f.dependencies)).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN' });
    const reserved = await reserveDocumentUpload(f.input, context, f.dependencies);
    expect((await reserveDocumentUpload(f.input, context, f.dependencies)).uploadKey).toBe(reserved.uploadKey);
    await expect(reserveDocumentUpload({ ...f.input, folderKey: newId() }, context, f.dependencies)).rejects.toMatchObject({ status: 409 });
    await expect(completeDocumentUpload({ teamKey, scopeKey, uploadKey: reserved.uploadKey, idempotencyKey: 'wrong' }, context, options, f.dependencies)).rejects.toMatchObject({ status: 404 });
    const another = { ...context, principal: { ...context.principal, user: { key: newId() } } };
    await expect(completeDocumentUpload({ teamKey, scopeKey, uploadKey: reserved.uploadKey, idempotencyKey: f.input.idempotencyKey }, another, options, f.dependencies)).rejects.toMatchObject({ status: 404 });
    await expect(completeDocumentUpload({ teamKey, scopeKey: newId(), uploadKey: reserved.uploadKey, idempotencyKey: f.input.idempotencyKey }, context, options, f.dependencies)).rejects.toMatchObject({ status: 404 });
    expect(f.calls).toHaveLength(0);
  });

  test('checks object metadata, rechecks permission, and invokes the canonical document.parse exactly once on replay', async () => {
    const f = fixture();
    const reserved = await reserveDocumentUpload(f.input, context, f.dependencies);
    const request = { teamKey, scopeKey, uploadKey: reserved.uploadKey, idempotencyKey: f.input.idempotencyKey };
    await expect(completeDocumentUpload(request, context, options, f.dependencies)).rejects.toMatchObject({ code: 'DOCUMENT_UPLOAD_MISMATCH' });
    const key = new URL(reserved.uploads[0]!.url).pathname.slice(1);
    f.stored.set(key, new TextEncoder().encode('text'));
    f.permit(false);
    await expect(completeDocumentUpload(request, context, options, f.dependencies)).rejects.toThrow('revoked');
    f.permit(true);
    f.fail(true);
    await expect(completeDocumentUpload(request, context, options, f.dependencies)).rejects.toThrow('processing failed');
    expect(f.stored.has(key)).toBe(true);
    f.fail(false);
    const result = await completeDocumentUpload(request, context, options, f.dependencies);
    expect(f.calls.at(-1)).toMatchObject({ input: { teamKey, scopeKey, tool: 'document.parse', input: { scopeKey, folderKey, idempotencyKey: f.input.idempotencyKey, file: { filename: 'note.txt', mimeType: 'text/plain', sizeBytes: 4, bytes: new Uint8Array([116, 101, 120, 116]) } } }, runOptions: { authenticatedUserKey: userKey, requestKey: f.input.idempotencyKey } });
    expect(f.deleted).toEqual([key]);
    const calls = f.calls.length;
    expect(await completeDocumentUpload(request, context, options, f.dependencies)).toEqual(result);
    expect(f.calls).toHaveLength(calls);
  });

  test('keeps scanned pages ordered when completing through the same parse tool', async () => {
    const f = fixture();
    const files = [1, 2].map((index) => ({ filename: `page-${index}.png`, mimeType: 'image/png', sizeBytes: index }));
    f.dependencies.inspect = async (storageKey: string) => ({ sizeBytes: f.stored.get(storageKey)?.byteLength, mimeType: 'image/png' });
    const input = { ...f.input, kind: 'pages' as const, files };
    const reserved = await reserveDocumentUpload(input, context, f.dependencies);
    reserved.uploads.forEach((upload, index) => f.stored.set(new URL(upload.url).pathname.slice(1), new Uint8Array(index + 1).fill(index + 1)));
    await completeDocumentUpload({ teamKey, scopeKey, uploadKey: reserved.uploadKey, idempotencyKey: input.idempotencyKey }, context, options, f.dependencies);
    expect(f.calls[0].input.input.pages).toEqual(files.map((file, index) => ({ ...file, bytes: new Uint8Array(index + 1).fill(index + 1) })));
  });
});
