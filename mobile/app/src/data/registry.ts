export type WorkspacePickerApp = {
  scopeKey: string;
  slug: string;
  name: string;
};

export type WorkspacePickerState = {
  apps: WorkspacePickerApp[];
  selectedScopeKeys: string[] | null;
};

export const emptyWorkspacePicker: WorkspacePickerState = { apps: [], selectedScopeKeys: null };
