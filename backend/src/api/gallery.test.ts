import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { galleryOperationInputSchemas } from '@/lib/gallery/operations';
import { duplicateSearchTransportInput } from './gallery';

describe('Gallery HTTP transport', () => {
  test('maps duplicate discovery to the canonical image search input', () => {
    const collectionKey = newId();
    expect(duplicateSearchTransportInput({ collectionKey })).toEqual({ duplicates: true, collectionKey });
    expect(galleryOperationInputSchemas.search.parse(duplicateSearchTransportInput({ collectionKey }))).toEqual({ duplicates: true, collectionKey });
    expect(() => galleryOperationInputSchemas.search.parse(duplicateSearchTransportInput({ collectionKey, unexpected: true }))).toThrow();
  });
});
