import { createHash } from 'node:crypto';

export const ARCHIVE_DEVELOPMENT_FOLDER_KEYS = {
  launch: 'cmsq7m4uk0003zk7k8xky303b',
  references: 'cmsq7m4uk0004zk7k2xwa8y5e',
  launchOperations: 'cmtd1r8ya0000zk7k2vpc4m1a',
  launchStrategy: 'cmtd1r8ya0001zk7k7kh9wq4e',
  interviews: 'cmtd1r8ya0002zk7k9s4bn5hx',
} as const;

export const ARCHIVE_DEVELOPMENT_ATTACHMENT_ASSETS = {
  roadmap: { type: 'document' as const, key: 'cmsq7m4ul0007zk7kbev12pfc', folderKey: ARCHIVE_DEVELOPMENT_FOLDER_KEYS.launch },
  pdfBrief: { type: 'document' as const, key: 'cmsrt115v00003g7kc2g08p7i', folderKey: ARCHIVE_DEVELOPMENT_FOLDER_KEYS.references },
  docxPlan: { type: 'document' as const, key: 'cmsrt115v00043g7k1dil1cce', folderKey: ARCHIVE_DEVELOPMENT_FOLDER_KEYS.launchStrategy },
  markdownRunbook: { type: 'document' as const, key: 'cmsrt115v00053g7k8cpe1urq', folderKey: ARCHIVE_DEVELOPMENT_FOLDER_KEYS.launchOperations },
  textInterviews: { type: 'document' as const, key: 'cmsrt115v00073g7k406886ls', folderKey: ARCHIVE_DEVELOPMENT_FOLDER_KEYS.interviews },
} as const;

export function galleryDevelopmentFixtureKey(scopeKey: string, kind: string, logicalName: string) {
  return `c${createHash('sha256').update(`${scopeKey}:${kind}:${logicalName}`).digest('hex').slice(0, 24)}`;
}

export function galleryDevelopmentAttachmentAsset(scopeKey: string, collectionSlug: string, imageNumber: number) {
  const logicalName = `${collectionSlug}-${String(imageNumber).padStart(2, '0')}`;
  return {
    type: 'image' as const,
    key: galleryDevelopmentFixtureKey(scopeKey, 'image', logicalName),
    collectionKey: galleryDevelopmentFixtureKey(scopeKey, 'collection', collectionSlug),
  };
}

export function emailDevelopmentAttachmentAssets(scopeKey: string) {
  return [
    ...Object.values(ARCHIVE_DEVELOPMENT_ATTACHMENT_ASSETS),
    galleryDevelopmentAttachmentAsset(scopeKey, 'nordic-light', 1),
    galleryDevelopmentAttachmentAsset(scopeKey, 'city-after-rain', 1),
    galleryDevelopmentAttachmentAsset(scopeKey, 'studio-objects', 1),
    galleryDevelopmentAttachmentAsset(scopeKey, 'coastal-days', 1),
  ];
}
