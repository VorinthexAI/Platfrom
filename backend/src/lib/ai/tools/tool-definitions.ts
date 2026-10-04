import { folderCreateToolDefinition } from './folder-create';
import { folderDeleteToolDefinition } from './folder-delete';
import { folderFindToolDefinition } from './folder-find';
import { folderListToolDefinition } from './folder-list';
import { folderCopyToolDefinition } from './folder-copy';
import { folderMoveToolDefinition } from './folder-move';
import { folderRenameToolDefinition } from './folder-rename';
import { folderUpdateToolDefinition } from './folder-update';
import { TRUSTED_ACCOUNT_TOOL_DEFINITIONS } from './account-tool-definitions';
import { CONVERSATION_TOOL_DEFINITIONS } from './conversation-tool-definitions';
import { CORE_TOOL_DEFINITIONS } from '@/lib/ai/agents/core';
import { billingSummaryReadToolDefinition } from './billing-summary-read';
import { referralSummaryReadToolDefinition } from './referral-summary-read';
import { referralRedeemToolDefinition } from './referral-redeem';
import { WORKSPACE_TOOL_DEFINITIONS } from './workspace-tool-definitions';
import { agentGreetToolDefinition } from './agent-greet';
import { ticketCreateToolDefinition, ticketListToolDefinition } from './ticket-tool-definitions';
import { appNotifyToolDefinition, notificationListToolDefinition, notificationMarkReadToolDefinition } from './notification-tool-definitions';
import { COMMERCE_TOOL_DEFINITIONS } from './commerce-tool-definitions';
import { createPublicToolDefinition } from './tool-definition';

export const fileListToolDefinition = createPublicToolDefinition('file.list');
export const fileFindToolDefinition = createPublicToolDefinition('file.find');
export const fileUpdateToolDefinition = createPublicToolDefinition('file.update');
export const fileRenameToolDefinition = createPublicToolDefinition('file.rename');
export const fileMoveToolDefinition = createPublicToolDefinition('file.move');
export const fileCopyToolDefinition = createPublicToolDefinition('file.copy');
export const fileDeleteToolDefinition = createPublicToolDefinition('file.delete');
export const fileDownloadToolDefinition = createPublicToolDefinition('file.download');
export const contentSearchToolDefinition = createPublicToolDefinition('content.search');
export const contentSearchHistoryRecordToolDefinition = createPublicToolDefinition('content.search-history.record');
export const contentSearchHistoryListToolDefinition = createPublicToolDefinition('content.search-history.list');
export const contentSearchHistoryDeleteToolDefinition = createPublicToolDefinition('content.search-history.delete');
export const tagListToolDefinition = createPublicToolDefinition('tag.list');
export const tagCreateToolDefinition = createPublicToolDefinition('tag.create');
export const tagAssignmentListToolDefinition = createPublicToolDefinition('tag.assignment.list');
export const tagAssignmentSetToolDefinition = createPublicToolDefinition('tag.assignment.set');

export const PUBLIC_TOOL_DEFINITIONS = Object.freeze([
  billingSummaryReadToolDefinition,
  referralSummaryReadToolDefinition,
  referralRedeemToolDefinition,
  ticketCreateToolDefinition, ticketListToolDefinition,
  appNotifyToolDefinition, notificationListToolDefinition, notificationMarkReadToolDefinition,
  ...COMMERCE_TOOL_DEFINITIONS,
  agentGreetToolDefinition,
  folderCreateToolDefinition, folderCopyToolDefinition, folderDeleteToolDefinition, folderFindToolDefinition, folderListToolDefinition, folderMoveToolDefinition, folderRenameToolDefinition, folderUpdateToolDefinition,
  fileListToolDefinition, fileFindToolDefinition, fileUpdateToolDefinition, fileRenameToolDefinition, fileMoveToolDefinition, fileCopyToolDefinition, fileDeleteToolDefinition, fileDownloadToolDefinition,
  contentSearchToolDefinition, contentSearchHistoryRecordToolDefinition, contentSearchHistoryListToolDefinition, contentSearchHistoryDeleteToolDefinition,
  tagListToolDefinition, tagCreateToolDefinition, tagAssignmentListToolDefinition, tagAssignmentSetToolDefinition,
  ...WORKSPACE_TOOL_DEFINITIONS,
  ...CONVERSATION_TOOL_DEFINITIONS,
  ...CORE_TOOL_DEFINITIONS,
] as const);

export const TRUSTED_TOOL_DEFINITIONS = Object.freeze([
  ...TRUSTED_ACCOUNT_TOOL_DEFINITIONS,
] as const);

export const UNIFIED_TOOL_DEFINITIONS = Object.freeze([
  ...PUBLIC_TOOL_DEFINITIONS,
  ...TRUSTED_TOOL_DEFINITIONS,
] as const);
