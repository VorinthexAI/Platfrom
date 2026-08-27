import { hashUserEmail, normalizeEmail } from '@/api/users';
import { closeDb, db } from '@/lib/db/client';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { getUserByEmailHash } from '@/lib/db/users.node';
import { encryptEmailConnectorCredentials, tokenFingerprint } from '@/lib/email-inbox/connector-crypto';
import { MAIL_DEV_FIXTURE_AT, MAIL_DEV_SEED_EMAIL } from '@/lib/email-inbox/dev-fixtures';
import { assertLocalMailSeedEnvironment, buildMailDevSeedManifest, mailDevFixtureKey, reconcileMailDevSeed, verifyMailDevSeed } from '@/lib/email-inbox/dev-seed';
import { createEmailService } from '@/lib/email-inbox/service';

async function main() {
  assertLocalMailSeedEnvironment(process.env);
  const targetEmail = normalizeEmail(MAIL_DEV_SEED_EMAIL);
  if (targetEmail !== 'oscar.burman005@gmail.com') throw new Error('Mail development seed target is not the approved normalized email.');
  const user = await getUserByEmailHash(await hashUserEmail(targetEmail));
  if (!user || normalizeEmail(user.email) !== targetEmail) throw new Error('The exact approved local development user is unavailable.');
  const context = await getPersonalAuthContext(user.key);
  if (!context) throw new Error('The approved local development user has no personal scope.');
  const placeholder = `local-fixture:${context.scope.key}`;
  const manifest = buildMailDevSeedManifest({
    organizationKey: context.organization.key,
    scopeKey: context.scope.key,
    membershipKey: context.membership.key,
    credentials: (_accountKey, providerAccountId) => ({
      ...encryptEmailConnectorCredentials({ accessToken: placeholder, tokenType: 'Fixture', expiresAt: MAIL_DEV_FIXTURE_AT }, { organizationKey: context.organization.key, scopeKey: context.scope.key, providerAccountId }),
      accessTokenFingerprint: tokenFingerprint(placeholder),
    }),
  });
  await reconcileMailDevSeed(db, manifest);
  const counts = await verifyMailDevSeed(db, manifest);
  const service = createEmailService({ authorize: async () => ({ membershipKey: context.membership.key, role: 'owner' }) });
  const actor = { userKey: user.key, organizationKey: context.organization.key, scopeKey: context.scope.key };
  const root = await service.overview(actor, {});
  if (!manifest.connectors.every(({ key }) => root.accounts.some(({ connectorKey }) => connectorKey === key))) throw new Error('Canonical mail overview did not expose every fixture inbox.');
  for (const connector of manifest.connectors) {
    const overview = await service.overview(actor, { connectorKey: connector.key });
    const expected = manifest.fixtures.threads.filter(({ thread }) => thread.accountKey === connector.key);
    if (overview.counts.all + overview.counts.trash !== expected.length) throw new Error('Canonical mail overview fixture count mismatch.');
    const first = expected[0]!.thread;
    const detail = await service.threadForTool(actor, mailDevFixtureKey('mail-thread', first.scopeKey, first.accountKey, first.providerThreadId));
    if (detail.messages.length !== expected[0]!.messages.length) throw new Error('Canonical mail thread fixture count mismatch.');
    const expectedAttachments = expected[0]!.messages.map(({ attachments }) => attachments ?? []);
    if (JSON.stringify(detail.messages.map(({ attachments }) => attachments ?? [])) !== JSON.stringify(expectedAttachments)) throw new Error('Canonical mail thread fixture attachments mismatch.');
  }
  console.log(JSON.stringify(counts));
}

try { await main(); } finally { await closeDb(); }
