import { hashUserEmail, normalizeEmail } from '@/api/users';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { closeDb, db } from '@/lib/db/client';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { getUserByEmailHash } from '@/lib/db/users.node';
import { encryptEmailConnectorCredentials, tokenFingerprint } from '@/lib/email-inbox/connector-crypto';
import { mailDevAttachmentFile } from '@/lib/email-inbox/dev-attachment-files';
import { MAIL_DEV_FIXTURE_AT, MAIL_DEV_SEED_EMAIL } from '@/lib/email-inbox/dev-fixtures';
import { assertLocalMailSeedEnvironment, buildMailDevSeedManifest, mailDevFixtureKey, reconcileMailDevSeed, verifyMailDevSeed } from '@/lib/email-inbox/dev-seed';
import { createEmailService } from '@/lib/email-inbox/service';
import { S3_BUCKET } from '@/lib/s3';

async function main() {
  assertLocalMailSeedEnvironment(process.env);
  const targetEmail = normalizeEmail(MAIL_DEV_SEED_EMAIL);
  if (targetEmail !== 'oscar.burman005@gmail.com') throw new Error('Mail development seed target is not the approved normalized email.');
  const user = await getUserByEmailHash(await hashUserEmail(targetEmail));
  if (!user || normalizeEmail(user.email) !== targetEmail) throw new Error('The exact approved local development user is unavailable.');
  const context = await getPersonalAuthContext(user.key);
  if (!context) throw new Error('The approved local development user has no personal scope.');
  const placeholder = `local-fixture:${context.scope.key}`;
  let s3Hostname = '';
  try { s3Hostname = new URL(process.env.S3_ENDPOINT_URL ?? process.env.AWS_ENDPOINT_URL ?? '').hostname; } catch { throw new Error('Mail development seed requires a local S3 endpoint.'); }
  if (s3Hostname !== 'localhost' && s3Hostname !== '127.0.0.1' && !s3Hostname.startsWith('192.168.')) throw new Error('Mail development seed requires a local S3 endpoint.');
  if (S3_BUCKET !== 'vorinthex-dev') throw new Error('Mail development seed may only use the vorinthex-dev bucket.');
  const manifest = buildMailDevSeedManifest({
    userKey: user.key,
    teamKey: context.team.key,
    scopeKey: context.scope.key,
    membershipKey: context.membership.key,
    credentials: (_accountKey, providerAccountId) => ({
      ...encryptEmailConnectorCredentials({ accessToken: placeholder, tokenType: 'Fixture', expiresAt: MAIL_DEV_FIXTURE_AT }, { teamKey: context.team.key, scopeKey: context.scope.key, providerAccountId }),
      accessTokenFingerprint: tokenFingerprint(placeholder),
    }),
  });
  for (const attachment of manifest.emailAttachments) {
    const file = mailDevAttachmentFile(attachment.kind, attachment.filename);
    if (file.contentHash !== attachment.contentHash) throw new Error('Mail fixture attachment bytes drifted from the seeded hash.');
    await documentStorage.upload({ key: attachment.storageKey!, bytes: file.bytes, mimeType: attachment.mimeType });
  }
  await reconcileMailDevSeed(db, manifest);
  const counts = await verifyMailDevSeed(db, manifest);
  const service = createEmailService({ authorize: async () => ({ teamMembershipKey: context.membership.key, role: 'owner' }) });
  const actor = { userKey: user.key, teamKey: context.team.key, scopeKey: context.scope.key };
  const root = await service.overview(actor, {});
  if (!manifest.connectors.every(({ key }) => root.accounts.some(({ connectorKey }) => connectorKey === key))) throw new Error('Canonical mail overview did not expose every fixture inbox.');
  for (const connector of manifest.connectors) {
    const overview = await service.overview(actor, { connectorKey: connector.key });
    const expected = manifest.fixtures.threads.filter(({ thread }) => thread.accountKey === connector.key);
    const expectedInbox = expected.filter(({ thread }) => thread.inInbox !== false);
    if (overview.counts.all + overview.counts.trash !== expectedInbox.length) throw new Error('Canonical mail overview fixture count mismatch.');
    const sent = await service.overview(actor, { connectorKey: connector.key, mailbox: 'sent' });
    if (sent.threads.length !== expected.filter(({ thread, messages }) => !thread.labels.includes('TRASH') && messages.some(({ messageIdHeader }) => /^<vorinthex-[a-z0-9]+@vorinthex\.com>$/.test(messageIdHeader ?? ''))).length) throw new Error('Canonical mail sent mailbox fixture count mismatch.');
    const first = expected[0]!.thread;
    const detail = await service.threadForTool(actor, mailDevFixtureKey('mail-thread', first.scopeKey, first.accountKey, first.providerThreadId));
    if (detail.messages.length !== expected[0]!.messages.length) throw new Error('Canonical mail thread fixture count mismatch.');
    const threadKey = mailDevFixtureKey('mail-thread', first.scopeKey, first.accountKey, first.providerThreadId);
    const expectedAttachments = manifest.emailMessages.filter((message) => message.threadKey === threadKey).map((message) => (message.attachments ?? []).map((ref) => {
      const binding = manifest.emailAttachments.find((attachment) => attachment.key === ref.key);
      if (!binding) throw new Error('Mail fixture attachment projection is missing.');
      return { type: binding.kind, key: binding.kind === 'document' ? binding.archiveDocumentKey : binding.galleryImageKey };
    }));
    if (JSON.stringify(detail.messages.map(({ attachments }) => attachments ?? [])) !== JSON.stringify(expectedAttachments)) throw new Error('Canonical mail thread fixture attachments mismatch.');
  }
  console.log(JSON.stringify(counts));
}

try { await main(); } finally { await closeDb(); }
