import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { newId } from '@/lib/ids';
import { completeProfileAvatarUpload, PROFILE_AVATAR_MAX_BYTES, profileAvatarReserveInputSchema, reserveProfileAvatarUpload, type ProfileAvatarReservation, type ProfileAvatarUploadDependencies } from './avatar-upload';

const userKey = newId();
const now = new Date('2026-09-03T10:00:00.000Z');

function harness() {
  const values = new Map<string, string>();
  const objects = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  const deleted: string[] = [];
  const replacements: string[] = [];
  const redis = {
    async get(key: string) { return values.get(key) ?? null; },
    async set(key: string, value: string, ...args: unknown[]) { if (args.includes('NX') && values.has(key)) return null; values.set(key, value); return 'OK'; },
    async del(...keys: string[]) { keys.forEach((key) => values.delete(key)); return keys.length; },
    async eval() { throw new Error('Use injected transition.'); },
  };
  const dependencies: ProfileAvatarUploadDependencies = {
    redis: redis as never,
    storage: {
      async upload({ key, bytes, mimeType }) { objects.set(key, { bytes: new Uint8Array(bytes), mimeType }); return { storageKey: key }; },
      async download(key) { const object = objects.get(key); if (!object) throw new Error('missing object'); return { ...object, sizeBytes: object.bytes.byteLength }; },
      async delete(key) { deleted.push(key); objects.delete(key); },
      async copy() { throw new Error('not used'); },
    },
    profileService: {
      async replaceAvatar(input, key) {
        const storageKey = (input as { storageKey: string }).storageKey;
        replacements.push(storageKey);
        return { profile: { key, name: 'Ada', profileStorageKey: storageKey, updatedAt: now.toISOString() }, previousStorageKey: null };
      },
    },
    signUpload: async (record) => `https://uploads.test/${record.key}`,
    inspectObject: async (key) => { const object = objects.get(key); return object ? { sizeBytes: object.bytes.byteLength, mimeType: object.mimeType } : {}; },
    transition: async (record, next) => {
      const key = `profile-avatar-upload:${record.key}`;
      const raw = values.get(key);
      if (!raw) return false;
      const current = JSON.parse(raw) as ProfileAvatarReservation;
      if (current.status !== record.status || current.userKey !== record.userKey) return false;
      values.set(key, JSON.stringify(next));
      return true;
    },
    now: () => now,
  };
  return { values, objects, deleted, replacements, dependencies };
}

describe('profile avatar upload', () => {
  test('strictly reserves one supported image for ten minutes and binds it to the user', async () => {
    expect(() => profileAvatarReserveInputSchema.parse({ filename: 'avatar.gif', mimeType: 'image/gif', sizeBytes: 1 })).toThrow();
    expect(() => profileAvatarReserveInputSchema.parse({ filename: 'avatar.jpg', mimeType: 'image/png', sizeBytes: 1 })).toThrow();
    expect(() => profileAvatarReserveInputSchema.parse({ filename: 'avatar.png', mimeType: 'image/png', sizeBytes: PROFILE_AVATAR_MAX_BYTES + 1 })).toThrow();
    expect(() => profileAvatarReserveInputSchema.parse({ filename: 'avatar.png', mimeType: 'image/png', sizeBytes: 1, userKey })).toThrow('Unrecognized key');

    const context = harness();
    const reserved = await reserveProfileAvatarUpload({ filename: 'avatar.webp', mimeType: 'image/webp', sizeBytes: 12 }, userKey, context.dependencies);
    expect(reserved).toMatchObject({ headers: { 'Content-Type': 'image/webp' }, expiresAt: '2026-09-03T10:10:00.000Z' });
    const record = JSON.parse(context.values.get(`profile-avatar-upload:${reserved.uploadKey}`)!) as ProfileAvatarReservation;
    expect(record).toMatchObject({ userKey, mimeType: 'image/webp', sizeBytes: 12, status: 'reserved' });
    expect(record.storageKey).toBe(`pending/profile-avatars/${userKey}/${record.key}/original.webp`);
  });

  test('verifies bytes, sanitizes, bounds, and persists an immutable canonical PNG', async () => {
    const context = harness();
    const jpeg = new Uint8Array(await sharp({ create: { width: 900, height: 600, channels: 3, background: '#336699' } }).jpeg().toBuffer());
    const reserved = await reserveProfileAvatarUpload({ filename: 'avatar.jpg', mimeType: 'image/jpeg', sizeBytes: jpeg.byteLength }, userKey, context.dependencies);
    const record = JSON.parse(context.values.get(`profile-avatar-upload:${reserved.uploadKey}`)!) as ProfileAvatarReservation;
    context.objects.set(record.storageKey, { bytes: jpeg, mimeType: 'image/jpeg' });

    const completed = await completeProfileAvatarUpload({ uploadKey: record.key }, userKey, context.dependencies);
    const canonicalKey = `profiles/${userKey}/${record.key}.png`;
    expect(completed).toMatchObject({ profile: { profileStorageKey: canonicalKey }, avatar: { mimeType: 'image/png', width: 512, height: 341 } });
    expect(context.replacements).toEqual([canonicalKey]);
    expect(await sharp(context.objects.get(canonicalKey)!.bytes).metadata()).toMatchObject({ format: 'png', width: 512, height: 341 });
    expect(context.deleted).toContain(record.storageKey);
    expect(context.values.has(`profile-avatar-upload:${record.key}`)).toBe(false);
  });

  test('rejects cross-user and spoofed uploads and cleans failed reservations', async () => {
    const context = harness();
    const png = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer());
    const reserved = await reserveProfileAvatarUpload({ filename: 'avatar.jpg', mimeType: 'image/jpeg', sizeBytes: png.byteLength }, userKey, context.dependencies);
    const record = JSON.parse(context.values.get(`profile-avatar-upload:${reserved.uploadKey}`)!) as ProfileAvatarReservation;
    context.objects.set(record.storageKey, { bytes: png, mimeType: 'image/jpeg' });
    await expect(completeProfileAvatarUpload({ uploadKey: record.key }, newId(), context.dependencies)).rejects.toMatchObject({ code: 'PROFILE_AVATAR_UPLOAD_NOT_FOUND' });
    await expect(completeProfileAvatarUpload({ uploadKey: record.key }, userKey, context.dependencies)).rejects.toMatchObject({ code: 'PROFILE_AVATAR_UPLOAD_MISMATCH' });
    expect(context.deleted).toContain(record.storageKey);
    expect(context.replacements).toEqual([]);
  });

  test('compensates canonical storage when profile replacement fails', async () => {
    const context = harness();
    const png = new Uint8Array(await sharp({ create: { width: 4, height: 3, channels: 3, background: '#fff' } }).png().toBuffer());
    const reserved = await reserveProfileAvatarUpload({ filename: 'avatar.png', mimeType: 'image/png', sizeBytes: png.byteLength }, userKey, { ...context.dependencies, profileService: { replaceAvatar: async () => { throw new Error('persistence failed'); } } });
    const record = JSON.parse(context.values.get(`profile-avatar-upload:${reserved.uploadKey}`)!) as ProfileAvatarReservation;
    context.objects.set(record.storageKey, { bytes: png, mimeType: 'image/png' });
    await expect(completeProfileAvatarUpload({ uploadKey: record.key }, userKey, { ...context.dependencies, profileService: { replaceAvatar: async () => { throw new Error('persistence failed'); } } })).rejects.toThrow('persistence failed');
    expect(context.deleted).toContain(`profiles/${userKey}/${record.key}.png`);
    expect(context.objects.has(`profiles/${userKey}/${record.key}.png`)).toBe(false);
  });

  test('retains canonical storage when persistence commits and then reports an ambiguous failure', async () => {
    const context = harness();
    const png = new Uint8Array(await sharp({ create: { width: 4, height: 3, channels: 3, background: '#fff' } }).png().toBuffer());
    const reserved = await reserveProfileAvatarUpload({ filename: 'avatar.png', mimeType: 'image/png', sizeBytes: png.byteLength }, userKey, context.dependencies);
    const record = JSON.parse(context.values.get(`profile-avatar-upload:${reserved.uploadKey}`)!) as ProfileAvatarReservation;
    const canonicalKey = `profiles/${userKey}/${record.key}.png`;
    context.objects.set(record.storageKey, { bytes: png, mimeType: 'image/png' });
    const failure = new Error('commit response lost');

    await expect(completeProfileAvatarUpload({ uploadKey: record.key }, userKey, {
      ...context.dependencies,
      profileService: { replaceAvatar: async () => { throw failure; } },
      isStorageReferenced: async (storageKey) => storageKey === canonicalKey,
    })).rejects.toBe(failure);

    expect(context.objects.has(canonicalKey)).toBe(true);
    expect(context.deleted).not.toContain(canonicalKey);
  });

  test('keeps the committed avatar when reservation cleanup fails', async () => {
    const context = harness();
    const png = new Uint8Array(await sharp({ create: { width: 4, height: 3, channels: 3, background: '#fff' } }).png().toBuffer());
    const reserved = await reserveProfileAvatarUpload({ filename: 'avatar.png', mimeType: 'image/png', sizeBytes: png.byteLength }, userKey, context.dependencies);
    const record = JSON.parse(context.values.get(`profile-avatar-upload:${reserved.uploadKey}`)!) as ProfileAvatarReservation;
    context.objects.set(record.storageKey, { bytes: png, mimeType: 'image/png' });
    (context.dependencies.redis as { del: () => Promise<number> }).del = async () => { throw new Error('redis unavailable'); };

    await expect(completeProfileAvatarUpload({ uploadKey: record.key }, userKey, context.dependencies)).resolves.toMatchObject({ profile: { profileStorageKey: `profiles/${userKey}/${record.key}.png` } });
    expect(context.objects.has(`profiles/${userKey}/${record.key}.png`)).toBe(true);
  });
});
