import { createWorkspacePickerService, type WorkspacePickerService } from './service';

export interface WorkspacePickerOperationContext {
  userKey: string;
  service?: WorkspacePickerService;
}

export const workspacePickerOperations = {
  read: (_input: Record<string, never>, context: WorkspacePickerOperationContext) => (context.service ?? createWorkspacePickerService()).read(context.userKey),
  update: (input: { scopeKeys: readonly string[] }, context: WorkspacePickerOperationContext) => (context.service ?? createWorkspacePickerService()).update(context.userKey, input.scopeKeys),
};
