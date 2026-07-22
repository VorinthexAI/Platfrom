import { expect, test } from 'bun:test'; import { storageUploadAction } from './storage-upload'; test('defines storage-upload', () => expect(storageUploadAction.id).toBe('storage-upload'));
