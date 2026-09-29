import { folderCreateToolDefinition } from './folder-create';
import { folderDeleteToolDefinition } from './folder-delete';
import { folderFindToolDefinition } from './folder-find';
import { folderListToolDefinition } from './folder-list';
import { folderMoveToolDefinition } from './folder-move';
import { folderRenameToolDefinition } from './folder-rename';
import { folderUpdateToolDefinition } from './folder-update';
import { TRUSTED_ACCOUNT_TOOL_DEFINITIONS } from './account-tool-definitions';
import { CONVERSATION_TOOL_DEFINITIONS } from './conversation-tool-definitions';
import { AGENT_TOOL_DEFINITIONS } from './agent-tool-definitions';
import { billingSummaryReadToolDefinition } from './billing-summary-read';
import { referralSummaryReadToolDefinition } from './referral-summary-read';
import { agentGuideToolDefinition } from './agent-guide';
import { WORKSPACE_TOOL_DEFINITIONS } from './workspace-tool-definitions';
import { createPublicToolDefinition } from './tool-definition';

export const fileListToolDefinition = createPublicToolDefinition('file.list');
export const fileFindToolDefinition = createPublicToolDefinition('file.find');
export const fileUpdateToolDefinition = createPublicToolDefinition('file.update');
export const fileRenameToolDefinition = createPublicToolDefinition('file.rename');
export const fileMoveToolDefinition = createPublicToolDefinition('file.move');
export const fileDeleteToolDefinition = createPublicToolDefinition('file.delete');
export const fileDownloadToolDefinition = createPublicToolDefinition('file.download');

export const PUBLIC_TOOL_DEFINITIONS = Object.freeze([
  billingSummaryReadToolDefinition,
  referralSummaryReadToolDefinition,
  agentGuideToolDefinition,
  folderCreateToolDefinition, folderDeleteToolDefinition, folderFindToolDefinition, folderListToolDefinition, folderMoveToolDefinition, folderRenameToolDefinition, folderUpdateToolDefinition,
  fileListToolDefinition, fileFindToolDefinition, fileUpdateToolDefinition, fileRenameToolDefinition, fileMoveToolDefinition, fileDeleteToolDefinition, fileDownloadToolDefinition,
  ...WORKSPACE_TOOL_DEFINITIONS,
  ...CONVERSATION_TOOL_DEFINITIONS,
  ...AGENT_TOOL_DEFINITIONS,
] as const);

export const TRUSTED_TOOL_DEFINITIONS = Object.freeze([
  ...TRUSTED_ACCOUNT_TOOL_DEFINITIONS,
] as const);

export const UNIFIED_TOOL_DEFINITIONS = Object.freeze([
  ...PUBLIC_TOOL_DEFINITIONS,
  ...TRUSTED_TOOL_DEFINITIONS,
] as const);
