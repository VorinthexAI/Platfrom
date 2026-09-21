import { hashUserEmail } from '@/api/users';
import { closeDb, db } from '@/lib/db/client';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { galleryOperations } from '@/lib/gallery/operations';
import { getUserByEmailHash } from '@/lib/db/users.node';

const email = process.argv.find((argument) => argument.startsWith('--email='))?.slice('--email='.length).trim().toLowerCase();
const name = process.argv.find((argument) => argument.startsWith('--collection='))?.slice('--collection='.length).trim();
const expectAbsent = process.argv.includes('--expect-absent');
if (!email || !name) throw new Error('Pass --email=<exact-email> and --collection=<exact-name>.');

try {
  const user = await getUserByEmailHash(await hashUserEmail(email));
  if (!user) throw new Error(`No user exists for ${email}.`);
  const context = await getPersonalAuthContext(user.key);
  if (!context) throw new Error(`No personal workspace exists for ${email}.`);
  const cursor = await db.query<string>(
    'FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.name == @name RETURN collection._key',
    { scopeKey: context.scope.key, name },
  );
  const keys = await cursor.all();
  if (expectAbsent) {
    if (keys.length !== 0) throw new Error(`Expected no collection named "${name}", found ${keys.length}.`);
    console.log(JSON.stringify({ email, scopeKey: context.scope.key, absentCollection: name }));
    process.exit(0);
  }
  if (keys.length !== 1) throw new Error(`Expected one collection named "${name}", found ${keys.length}.`);
  await galleryOperations.deleteCollection({ collectionKey: keys[0]! }, { teamKey: context.team.key, scopeKey: context.scope.key, membership: context.membership });
  console.log(JSON.stringify({ email, scopeKey: context.scope.key, deletedCollection: name }));
} finally {
  await closeDb();
}
