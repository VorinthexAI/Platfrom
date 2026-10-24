export const APP_LOGO_PREFIX = 'apps/logos/v1/';

export const APP_LOGO_MANIFEST = {
  'vorinthex-ai': { storageKey: `${APP_LOGO_PREFIX}vorinthex-ai.png`, sourcePath: 'web/app/public/logos/vorinthex-mark.png' },
  archive: { storageKey: `${APP_LOGO_PREFIX}archive.png`, sourcePath: 'web/app/public/logos/entities/capability-archive.png' },
  gallery: { storageKey: `${APP_LOGO_PREFIX}gallery.png`, sourcePath: 'web/app/public/logos/entities/capability-gallery.png' },
  compass: { storageKey: `${APP_LOGO_PREFIX}compass.png`, sourcePath: 'web/app/public/logos/entities/capability-compass.png' },
  signal: { storageKey: `${APP_LOGO_PREFIX}signal.png`, sourcePath: 'web/app/public/logos/entities/capability-signal.png' },
  ascend: { storageKey: `${APP_LOGO_PREFIX}ascend.png`, sourcePath: 'web/app/public/logos/entities/capability-ascend.png' },
  core: { storageKey: `${APP_LOGO_PREFIX}core.png`, sourcePath: 'web/app/public/logos/entities/product-core.png' },
} as const;

export type AppLogoSlug = keyof typeof APP_LOGO_MANIFEST;
