import { createHash } from 'node:crypto';

const stableKey = (kind: string, ...values: string[]) => `c${createHash('sha256').update([kind, ...values].join('\0')).digest('hex').slice(0, 24)}`;

export const emailMediaCollectionKey = (scopeKey: string) => stableKey('email-gallery-export-collection', scopeKey);
export const emailArchiveRootFolderKey = (scopeKey: string) => stableKey('email-archive-export-root', scopeKey);
export const emailArchiveInboxFolderKey = (scopeKey: string, connectorKey: string) => stableKey('email-archive-export-inbox', scopeKey, connectorKey);

export function emailExportContainerKeys(scopeKey: string, connectorKey: string) {
  return {
    rootKey: emailArchiveRootFolderKey(scopeKey),
    inboxKey: emailArchiveInboxFolderKey(scopeKey, connectorKey),
    collectionKey: emailMediaCollectionKey(scopeKey),
  };
}
