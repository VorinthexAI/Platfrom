import { audioGenerateTool } from './audio-generate';
import { bookCreateContextToolDefinition } from './book-create-context';
import { bookWriteToolDefinition } from './book-write';
import { documentContentToolDefinition } from './document-content';
import { documentAudioPlaybackClearToolDefinition } from './document-audio-playback-clear';
import { documentAudioPlaybackUpdateToolDefinition } from './document-audio-playback-update';
import { documentCreateToolDefinition } from './document-create';
import { documentCopyToolDefinition } from './document-copy';
import { documentCreateVersionToolDefinition } from './document-create-version';
import { documentDeleteToolDefinition } from './document-delete';
import { documentDeleteVersionToolDefinition } from './document-delete-version';
import { documentEnhanceToolDefinition } from './document-enhance';
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
import { documentRestoreToolDefinition } from './document-restore';
import { documentRestoreVersionToolDefinition } from './document-restore-version';
import { documentRewriteToolDefinition } from './document-rewrite';
import { documentShareToolDefinition } from './document-share';
import { documentShareContentTool } from './document-share-content';
import { documentShareRestoreTool } from './document-share-restore';
import { documentSummarizeToolDefinition } from './document-summarize';
import { documentSummaryAudioGenerateToolDefinition } from './document-summary-audio-generate';
import { documentTranslateToolDefinition } from './document-translate';
import { documentTopicsToolDefinition } from './document-topics';
import { documentUnshareToolDefinition } from './document-unshare';
import { documentUpdateToolDefinition } from './document-update';
import { documentVersionContentTool } from './document-version-content';
import { documentVersionRestoreTool } from './document-version-restore';
import { emailReplyDraftTool } from './email-reply-draft';
import { emailThreadListTool } from './email-thread-list';
import { emailThreadReadTool } from './email-thread-read';
import { folderContentToolDefinition } from './folder-content';
import { folderCopyToolDefinition } from './folder-copy';
import { folderCreateToolDefinition } from './folder-create';
import { folderDeleteToolDefinition } from './folder-delete';
import { folderFindToolDefinition } from './folder-find';
import { folderListToolDefinition } from './folder-list';
import { folderMoveToolDefinition } from './folder-move';
import { folderRenameToolDefinition } from './folder-rename';
import { folderRestoreToolDefinition } from './folder-restore';
import { folderUpdateToolDefinition } from './folder-update';
import { imageCaptionTool } from './image-caption';
import { imageCreateVisualIdentityTool } from './image-create-visual-identity';
import { imageSearchTool } from './image-search';
import { orchestratorChatTool } from './orchestrator-chat';
import { organizationDocumentSearchToolDefinition } from './organization-document-search';
import { scopeContentSearchToolDefinition } from './scope-content-search';
import { scopeContentSearchHistoryToolDefinition } from './scope-content-search-history';
import { scopeContentSearchHistoryDeleteToolDefinition } from './scope-content-search-history-delete';
import { contentNeighborsToolDefinition } from './content-neighbors';
import { scopeDocumentSearchToolDefinition } from './scope-document-search';
import { WORKSPACE_TOOL_DEFINITIONS } from './workspace-tool-definitions';

export const PUBLIC_TOOL_DEFINITIONS = Object.freeze([
  orchestratorChatTool,
  audioGenerateTool,
  imageCaptionTool,
  imageCreateVisualIdentityTool,
  imageSearchTool,
  contentNeighborsToolDefinition,
  bookCreateContextToolDefinition,
  bookWriteToolDefinition,
  emailThreadListTool, emailThreadReadTool, emailReplyDraftTool,
  documentAudioPlaybackClearToolDefinition, documentAudioPlaybackUpdateToolDefinition, documentContentToolDefinition, documentCreateToolDefinition, documentCopyToolDefinition, documentCreateVersionToolDefinition, documentDeleteToolDefinition, documentDeleteVersionToolDefinition, documentDownloadToolDefinition, documentEnhanceToolDefinition, documentExportToolDefinition, documentFindToolDefinition, documentFindSummaryToolDefinition, documentFindVersionToolDefinition, documentListToolDefinition, documentListAudioVersionsToolDefinition, documentListSummariesToolDefinition, documentListSharesToolDefinition, documentListVersionsToolDefinition, documentMoveToolDefinition, documentParseToolDefinition, documentReadToolDefinition, documentRenameToolDefinition, documentScanToolDefinition, documentRestoreToolDefinition, documentRestoreVersionToolDefinition, documentRewriteToolDefinition, documentShareToolDefinition, documentShareContentTool, documentShareRestoreTool, documentSummarizeToolDefinition, documentSummaryAudioGenerateToolDefinition, documentTopicsToolDefinition, documentTranslateToolDefinition, documentUnshareToolDefinition, documentUpdateToolDefinition, documentVersionContentTool, documentVersionRestoreTool,
  folderContentToolDefinition, folderCopyToolDefinition, folderCreateToolDefinition, folderDeleteToolDefinition, folderFindToolDefinition, folderListToolDefinition, folderMoveToolDefinition, folderRenameToolDefinition, folderRestoreToolDefinition, folderUpdateToolDefinition,
  organizationDocumentSearchToolDefinition,
  scopeContentSearchToolDefinition, scopeContentSearchHistoryToolDefinition, scopeContentSearchHistoryDeleteToolDefinition, scopeDocumentSearchToolDefinition,
  ...WORKSPACE_TOOL_DEFINITIONS,
] as const);
