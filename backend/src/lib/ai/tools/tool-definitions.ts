import { documentAudioPlaybackClearToolDefinition } from './document-audio-playback-clear';
import { documentAudioPlaybackUpdateToolDefinition } from './document-audio-playback-update';
import { documentCreateToolDefinition } from './document-create';
import { documentCopyToolDefinition } from './document-copy';
import { documentCreateVersionToolDefinition } from './document-create-version';
import { documentDeleteToolDefinition } from './document-delete';
import { documentDeleteVersionToolDefinition } from './document-delete-version';
import { documentDownloadToolDefinition } from './document-download';
import { documentExportToolDefinition } from './document-export';
import { documentFindToolDefinition } from './document-find';
import { documentFindVersionToolDefinition } from './document-find-version';
import { documentFindSummaryToolDefinition } from './document-find-summary';
import { documentListToolDefinition } from './document-list';
import { documentListAudioVersionsToolDefinition } from './document-list-audio-versions';
import { documentListSummariesToolDefinition } from './document-list-summaries';
import { documentListSharesToolDefinition } from './document-list-shares';
import { documentListVersionsToolDefinition } from './document-list-versions';
import { documentMoveToolDefinition } from './document-move';
import { documentParseToolDefinition } from './document-parse';
import { documentReadToolDefinition } from './document-read';
import { documentRenameToolDefinition } from './document-rename';
import { documentScanToolDefinition } from './document-scan';
import { documentRestoreVersionToolDefinition } from './document-restore-version';
import { documentRewriteToolDefinition } from './document-rewrite';
import { documentShareToolDefinition } from './document-share';
import { documentSummarizeToolDefinition } from './document-summarize';
import { documentTopicsToolDefinition } from './document-topics';
import { documentUnshareToolDefinition } from './document-unshare';
import { documentUpdateToolDefinition } from './document-update';
import { folderCopyToolDefinition } from './folder-copy';
import { folderCreateToolDefinition } from './folder-create';
import { folderDeleteToolDefinition } from './folder-delete';
import { folderFindToolDefinition } from './folder-find';
import { folderListToolDefinition } from './folder-list';
import { folderMoveToolDefinition } from './folder-move';
import { folderRenameToolDefinition } from './folder-rename';
import { folderUpdateToolDefinition } from './folder-update';
import { imageCaptionTool } from './image-caption';
import { imageCreateVisualIdentityTool } from './image-create-visual-identity';
import { documentSearchAllToolDefinition } from './document-search-all';
import { contentSearchToolDefinition } from './content-search';
import { contentSearchHistoryListToolDefinition } from './content-search-history-list';
import { contentSearchHistoryDeleteToolDefinition } from './content-search-history-delete';
import { contentNeighborsToolDefinition } from './content-neighbors';
import { documentSearchToolDefinition } from './document-search';
import { WORKSPACE_TOOL_DEFINITIONS } from './workspace-tool-definitions';
import { TRUSTED_EMAIL_TOOL_DEFINITIONS } from './email-ingestion-tool-definitions';
import { CONVERSATION_TOOL_DEFINITIONS } from './conversation-tool-definitions';

export const PUBLIC_TOOL_DEFINITIONS = Object.freeze([
  imageCaptionTool,
  imageCreateVisualIdentityTool,
  contentNeighborsToolDefinition,
  documentAudioPlaybackClearToolDefinition, documentAudioPlaybackUpdateToolDefinition, documentCreateToolDefinition, documentCopyToolDefinition, documentCreateVersionToolDefinition, documentDeleteToolDefinition, documentDeleteVersionToolDefinition, documentDownloadToolDefinition, documentExportToolDefinition, documentFindToolDefinition, documentFindSummaryToolDefinition, documentFindVersionToolDefinition, documentListToolDefinition, documentListAudioVersionsToolDefinition, documentListSummariesToolDefinition, documentListSharesToolDefinition, documentListVersionsToolDefinition, documentMoveToolDefinition, documentParseToolDefinition, documentReadToolDefinition, documentRenameToolDefinition, documentScanToolDefinition, documentRestoreVersionToolDefinition, documentRewriteToolDefinition, documentShareToolDefinition, documentSummarizeToolDefinition, documentTopicsToolDefinition, documentUnshareToolDefinition, documentUpdateToolDefinition,
  folderCopyToolDefinition, folderCreateToolDefinition, folderDeleteToolDefinition, folderFindToolDefinition, folderListToolDefinition, folderMoveToolDefinition, folderRenameToolDefinition, folderUpdateToolDefinition,
  documentSearchAllToolDefinition,
  contentSearchToolDefinition, contentSearchHistoryListToolDefinition, contentSearchHistoryDeleteToolDefinition, documentSearchToolDefinition,
  ...WORKSPACE_TOOL_DEFINITIONS,
  ...CONVERSATION_TOOL_DEFINITIONS,
] as const);

/** Canonical registry entries that only authenticated server workflows may dispatch. */
export const TRUSTED_TOOL_DEFINITIONS = TRUSTED_EMAIL_TOOL_DEFINITIONS;

/** Every canonical business tool, including trusted protocol-triggered entries. */
export const UNIFIED_TOOL_DEFINITIONS = Object.freeze([
  ...PUBLIC_TOOL_DEFINITIONS,
  ...TRUSTED_TOOL_DEFINITIONS,
] as const);
