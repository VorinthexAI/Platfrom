import { legacySchemaMigration } from './0001-legacy-schema';
import { sparkEventIndexMigration } from './0002-spark-event-index';
import { fundingRequirementIndexMigration } from './0003-funding-requirement-index';
import { eventDeviceMigration } from './0004-event-device';
import { canonicalManagedArchiveFoldersMigration } from './0005-canonical-managed-archive-folders';
import { initialAudiobookMigration } from './0006-initial-audiobook';
import { managedAudiobookLiveCoverMigration } from './0007-managed-audiobook-live-cover';
import { privateEmailOwnershipMigration } from './0008-private-email-ownership';
import { userInboxMigration } from './0009-user-inbox';
import { conversationMessageRecallIndexMigration } from './0010-conversation-message-recall-index';
import { conversationAttachmentArtifactsMigration } from './0011-conversation-attachment-artifacts';
import { retireNavigationVisitsMigration } from './0012-retire-navigation-visits';
import { conversationArchiveProjectionMigration } from './0013-conversation-archive-projection';
import { repairConversationArchiveProjectionMigration } from './0014-repair-conversation-archive-projection';
import { removeUnnamedConversationProjectionsMigration } from './0015-remove-unnamed-conversation-projections';
import { seedCountryEmbeddingsMigration } from './0016-country-embeddings';
import { hiddenScopeVisibilityMigration } from './0017-hidden-scope-visibility';
import { canonicalSeedMigration } from './0018-canonical-seed';
import { userNotificationsMigration } from './0019-user-notifications';
import { workspaceSearchMigration } from './0020-workspace-search';
import type { GraphMigration } from './types';

// Add each new migration here once. Applied entries are immutable.
export const graphMigrations: readonly GraphMigration[] = [legacySchemaMigration, sparkEventIndexMigration, fundingRequirementIndexMigration, eventDeviceMigration, canonicalManagedArchiveFoldersMigration, initialAudiobookMigration, managedAudiobookLiveCoverMigration, privateEmailOwnershipMigration, userInboxMigration, conversationMessageRecallIndexMigration, conversationAttachmentArtifactsMigration, retireNavigationVisitsMigration, conversationArchiveProjectionMigration, repairConversationArchiveProjectionMigration, removeUnnamedConversationProjectionsMigration, seedCountryEmbeddingsMigration, hiddenScopeVisibilityMigration, canonicalSeedMigration, userNotificationsMigration, workspaceSearchMigration];
