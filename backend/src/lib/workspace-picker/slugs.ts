export const WORKSPACE_PICKER_SLUGS = ['archive', 'gallery', 'compass', 'signal', 'ascend', 'hq'] as const;
export type WorkspacePickerSlug = (typeof WORKSPACE_PICKER_SLUGS)[number];
