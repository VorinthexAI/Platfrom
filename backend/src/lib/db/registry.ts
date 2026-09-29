import type { Page } from './base';
import { getAllVisitorSessionsChunked, listVisitorSessionsPage, upsertVisitorSessionByKey } from './visitor-sessions.node';
import { getAllUserSessionsChunked, listUserSessionsPage, upsertUserSessionByKey } from './user-sessions.node';
import { getAllAuthChallengesChunked, listAuthChallengesPage, upsertAuthChallengeByKey } from './auth-challenges.node';
import { getAllUsersChunked, listUsersPage, upsertUserByKey } from './users.node';
import { getAllVisitorsChunked, listVisitorsPage, upsertVisitorByKey } from './visitors.node';
import { getAllFoldersChunked, listFoldersPage, upsertFolderByKey } from './folders.node';
import { getAllFilesChunked, listFilesPage, upsertFileByKey } from './files.node';

export interface NodeAccessors {
  listPage: (after?: string, limit?: number) => Promise<Page<unknown>>;
  getAllChunked: (chunkSize?: number) => AsyncGenerator<unknown[], void, void>;
  upsertByKey: (input: never) => Promise<unknown>;
}

export const NODE_REGISTRY: Record<string, NodeAccessors> = {
  authChallenges: { listPage: listAuthChallengesPage, getAllChunked: getAllAuthChallengesChunked, upsertByKey: upsertAuthChallengeByKey },
  folders: { listPage: listFoldersPage, getAllChunked: getAllFoldersChunked, upsertByKey: upsertFolderByKey },
  files: { listPage: listFilesPage, getAllChunked: getAllFilesChunked, upsertByKey: upsertFileByKey },
  userSessions: { listPage: listUserSessionsPage, getAllChunked: getAllUserSessionsChunked, upsertByKey: upsertUserSessionByKey },
  users: { listPage: listUsersPage, getAllChunked: getAllUsersChunked, upsertByKey: upsertUserByKey },
  visitorSessions: { listPage: listVisitorSessionsPage, getAllChunked: getAllVisitorSessionsChunked, upsertByKey: upsertVisitorSessionByKey },
  visitors: { listPage: listVisitorsPage, getAllChunked: getAllVisitorsChunked, upsertByKey: upsertVisitorByKey },
};

export const NODE_NAMES = Object.keys(NODE_REGISTRY).sort();

export function registerNode(name: string, accessors: NodeAccessors): void {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error(`Invalid node name: ${name}`);
  if (NODE_REGISTRY[name]) throw new Error(`Node already registered: ${name}`);
  NODE_REGISTRY[name] = accessors;
  NODE_NAMES.splice(0, NODE_NAMES.length, ...Object.keys(NODE_REGISTRY).sort());
}
