import { accountDeleteInputSchema, accountDeletionService, type AccountDeletionService } from '@/lib/account-deletion/service';
import { workspacePickerService, workspacePickerUpdateInputSchema, type WorkspacePickerService } from '@/lib/workspace-picker/service';
import type { ToolContext } from './tool-context';
import { ToolExecutionError } from './tool-context';

export interface TrustedAccountToolDependencies {
  context: ToolContext;
  accountDeletion?: AccountDeletionService;
  workspacePicker?: WorkspacePickerService;
}

export const TRUSTED_ACCOUNT_TOOL_DEFINITIONS = Object.freeze([{
  name: 'account.delete',
  inputSchema: accountDeleteInputSchema,
  async execute(rawInput: unknown, dependencies: TrustedAccountToolDependencies) {
    const principal = dependencies.context.principal;
    if (principal.kind !== 'member' || principal.userTeam.userId !== principal.user.key) {
      throw new ToolExecutionError('TOOL_FORBIDDEN', 'Authenticated user context is required.');
    }
    return (dependencies.accountDeletion ?? accountDeletionService).delete(rawInput, principal.user.key);
  },
}, {
  name: 'workspace.picker.update',
  inputSchema: workspacePickerUpdateInputSchema,
  async execute(rawInput: unknown, dependencies: TrustedAccountToolDependencies) {
    const principal = dependencies.context.principal;
    if (principal.kind !== 'member' || principal.userTeam.userId !== principal.user.key) {
      throw new ToolExecutionError('TOOL_FORBIDDEN', 'Authenticated user context is required.');
    }
    const input = workspacePickerUpdateInputSchema.parse(rawInput);
    return (dependencies.workspacePicker ?? workspacePickerService).update(principal.user.key, input.scopeKeys);
  },
}] as const);

export type TrustedAccountToolName = typeof TRUSTED_ACCOUNT_TOOL_DEFINITIONS[number]['name'];
