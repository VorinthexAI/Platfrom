import { hashUserEmail } from '@/api/users';
import { closeDb } from '@/lib/db/client';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { getUserByEmailHash } from '@/lib/db/users.node';
import { MAIL_DEV_SEED_EMAIL, mailDevFixtures } from '@/lib/email-inbox/dev-fixtures';
import { createEmailRepository } from '@/lib/email-inbox/repository';

function requireLocalDatabase(value: string | undefined) {
  if (process.env.NODE_ENV === 'production' || !value || !/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.)/.test(value)) throw new Error('Mail dev seed requires a local development ArangoDB endpoint.');
}

async function main() {
  requireLocalDatabase(process.env.ARANGO_URL);
  const user = await getUserByEmailHash(await hashUserEmail(MAIL_DEV_SEED_EMAIL));
  if (!user) throw new Error(`Dev user ${MAIL_DEV_SEED_EMAIL} does not exist. Sign in once before seeding.`);
  const context = await getPersonalAuthContext(user.key);
  if (!context) throw new Error(`Personal scope for ${MAIL_DEV_SEED_EMAIL} is unavailable.`);
  const repository = createEmailRepository();
  const fixtures = mailDevFixtures(context.scope.key, context.scope.key);
  await repository.ensureFolders(context.scope.key);
  await repository.listTones(context.scope.key);
  for (const fixture of fixtures.threads) await repository.syncThread(fixture);
  console.log(`Seeded ${fixtures.threads.length} Archive-backed mail threads for ${MAIL_DEV_SEED_EMAIL}.`);
}

try { await main(); } finally { await closeDb(); }
