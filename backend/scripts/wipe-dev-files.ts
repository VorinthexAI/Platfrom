import { closeDb, db, withTransaction } from '@/lib/db/client';
import { memberPrincipal, type ToolContext } from '@/lib/ai/tools/tool-context';
import { scopeService } from '@/lib/ai/scopes/service';
import { drainStorageDeletionJobs } from '@/lib/storage-deletion';
import { redisConnection } from '@/lib/redis';
import { targetDevUser } from './dev/files-environment';

async function main() {
  const user = await targetDevUser(process.argv.slice(2));
  const context: ToolContext = { userKey: user.key, teamKey: user.key, runtimeScopeKey: user.currentScopeKey, principal: memberPrincipal(user) };
  const scopes = (await scopeService.list(context)).scopes;
  const mainScope = scopes.find(({ slug }) => slug === 'main');
  if (!mainScope) throw new Error('The target account has no main scope; refusing to wipe.');

  const preview = await db.query('RETURN { files: LENGTH(FOR f IN files FILTER f.userKey == @userKey RETURN 1), folders: LENGTH(FOR f IN folders FILTER f.userKey == @userKey RETURN 1) }', { userKey: user.key });
  console.log(JSON.stringify({ email: user.email, scopesToDelete: scopes.filter(({ slug }) => slug !== 'main').map(({ name }) => name), ...(await preview.next() as object) }));

  const now = new Date().toISOString();
  const storageKeys = await withTransaction(['files', 'conversationAttachmentArtifacts', 'storageDeletionJobs'], async (trx) => {
    const keys = await trx.query('RETURN UNIQUE(UNION((FOR file IN files FILTER file.userKey == @userKey FOR key IN [file.storageKey, file.thumbnailStorageKey] FILTER IS_STRING(key) RETURN key), (FOR artifact IN conversationAttachmentArtifacts FILTER artifact.userKey == @userKey && IS_STRING(artifact.stagedStorageKey) RETURN artifact.stagedStorageKey)))', { userKey: user.key });
    const storageKeys = await keys.next() as string[];
    await trx.query('FOR storageKey IN @storageKeys UPSERT { storageKey } INSERT { storageKey, createdAt: @now, status: "pending" } UPDATE { status: "pending", claimToken: null, claimedAt: null, reservationExpiresAt: null } IN storageDeletionJobs OPTIONS { keepNull: false }', { storageKeys, now });
    await trx.query('FOR file IN files FILTER file.userKey == @userKey REMOVE file IN files', { userKey: user.key });
    await trx.query('FOR artifact IN conversationAttachmentArtifacts FILTER artifact.userKey == @userKey REMOVE artifact IN conversationAttachmentArtifacts', { userKey: user.key });
    return storageKeys;
  });

  for (const scope of scopes) {
    if (scope.key === mainScope.key) continue;
    await scopeService.delete({ targetScopeKey: scope.key }, { ...context, runtimeScopeKey: scope.key });
  }
  await db.query('FOR folder IN folders FILTER folder.userKey == @userKey REMOVE folder IN folders', { userKey: user.key });
  await db.query('UPDATE @key WITH { currentScopeKey: @mainKey, updatedAt: @now } IN users', { key: user.key, mainKey: mainScope.key, now });

  // Drain the same fenced, reference-checked deletion outbox used by the backend.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pending = await db.query('FOR job IN storageDeletionJobs FILTER job.storageKey IN @storageKeys LIMIT 1 RETURN 1', { storageKeys });
    if ((await pending.all()).length === 0) break;
    const result = await drainStorageDeletionJobs(100);
    if (result.deleted === 0 && result.pending > 0) break;
  }
  const pending = await db.query('FOR job IN storageDeletionJobs FILTER job.storageKey IN @storageKeys LIMIT 1 RETURN 1', { storageKeys });
  if (await pending.next()) throw new Error('The dev account metadata was removed, but some storage deletion jobs are still pending. Run this command again to retry them.');
  const check = await db.query('RETURN { scopes: LENGTH(FOR s IN scopes FILTER s.userKey == @userKey RETURN 1), files: LENGTH(FOR f IN files FILTER f.userKey == @userKey RETURN 1), folders: LENGTH(FOR f IN folders FILTER f.userKey == @userKey RETURN 1) }', { userKey: user.key });
  const counts = await check.next() as { scopes: number; files: number; folders: number };
  if (counts.scopes !== 1 || counts.files || counts.folders) throw new Error(`Incomplete dev wipe: ${JSON.stringify(counts)}`);
  console.log(JSON.stringify({ wiped: user.email, ...counts, mainScope: mainScope.key }));
}

if (import.meta.main) {
  try { await main(); }
  catch (error) { console.error(error); process.exitCode = 1; }
  finally { redisConnection.disconnect(); await closeDb(); }
  process.exit(process.exitCode ?? 0);
}
