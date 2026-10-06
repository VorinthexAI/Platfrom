import { schemaMigration } from './0001-schema';
import { workspaceSearchViewMigration } from './0002-workspace-search-view';
import { conversationProjectionStateMigration } from './0003-conversation-projection-state';
import { storeCatalogMigration } from './0010-store-catalog';
import { actionEventIndexMigration } from './0005-action-event-index';
import { scopeTagsMigration } from './0006-scope-tags';
import { userSearchesMigration } from './0007-user-searches';
import { fileThumbnailsMigration } from './0008-file-thumbnails';
import { supportTicketsMigration } from './0009-support-tickets';
import type { GraphMigration } from './types';

export const graphMigrations: readonly GraphMigration[] = [schemaMigration, workspaceSearchViewMigration, conversationProjectionStateMigration, actionEventIndexMigration, scopeTagsMigration, userSearchesMigration, fileThumbnailsMigration, supportTicketsMigration, storeCatalogMigration];
