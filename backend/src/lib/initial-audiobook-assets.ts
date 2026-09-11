export const INITIAL_AUDIOBOOK_ASSET_PREFIX = 'system/initial-audiobook/v1/';

export const INITIAL_AUDIOBOOK_CHAPTER_GUIDE_IDS = [
  'assistant-overview',
  'knowledge-overview',
  'media-overview',
  'communication-overview',
  'travel-overview',
  'learning-overview',
] as const;

export const INITIAL_AUDIOBOOK_ASSET_MANIFEST = {
  chapters: [
    { storageKey: `${INITIAL_AUDIOBOOK_ASSET_PREFIX}chapter-01.mp3`, sourcePath: 'backend/assets/initial-audiobook/chapter-01.mp3', contentType: 'audio/mpeg', durationSeconds: 41 },
    { storageKey: `${INITIAL_AUDIOBOOK_ASSET_PREFIX}chapter-02.mp3`, sourcePath: 'backend/assets/initial-audiobook/chapter-02.mp3', contentType: 'audio/mpeg', durationSeconds: 44 },
    { storageKey: `${INITIAL_AUDIOBOOK_ASSET_PREFIX}chapter-03.mp3`, sourcePath: 'backend/assets/initial-audiobook/chapter-03.mp3', contentType: 'audio/mpeg', durationSeconds: 46 },
    { storageKey: `${INITIAL_AUDIOBOOK_ASSET_PREFIX}chapter-04.mp3`, sourcePath: 'backend/assets/initial-audiobook/chapter-04.mp3', contentType: 'audio/mpeg', durationSeconds: 48 },
    { storageKey: `${INITIAL_AUDIOBOOK_ASSET_PREFIX}chapter-05.mp3`, sourcePath: 'backend/assets/initial-audiobook/chapter-05.mp3', contentType: 'audio/mpeg', durationSeconds: 43 },
    { storageKey: `${INITIAL_AUDIOBOOK_ASSET_PREFIX}chapter-06.mp3`, sourcePath: 'backend/assets/initial-audiobook/chapter-06.mp3', contentType: 'audio/mpeg', durationSeconds: 40 },
  ],
} as const;
