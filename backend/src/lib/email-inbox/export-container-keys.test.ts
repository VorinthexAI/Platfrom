import { describe, expect, test } from 'bun:test';
import { emailExportContainerKeys } from './export-container-keys';

describe('email export destinations', () => {
  test('always reuses one scope root, one scope collection, and one connector folder', () => {
    const first = emailExportContainerKeys('scope-1', 'connector-1');
    expect(emailExportContainerKeys('scope-1', 'connector-1')).toEqual(first);
    expect(emailExportContainerKeys('scope-1', 'connector-2')).toMatchObject({
      rootKey: first.rootKey,
      collectionKey: first.collectionKey,
    });
    expect(emailExportContainerKeys('scope-1', 'connector-2').inboxKey).not.toBe(first.inboxKey);
    expect(emailExportContainerKeys('scope-2', 'connector-1')).not.toMatchObject({
      rootKey: first.rootKey,
      collectionKey: first.collectionKey,
    });
  });
});
