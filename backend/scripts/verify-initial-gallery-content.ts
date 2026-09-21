import { hashUserEmail } from '@/api/users';
import { closeDb, db } from '@/lib/db/client';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { getUserByEmailHash } from '@/lib/db/users.node';
import { initialWorkspaceContentService } from '@/lib/initial-workspace-content';

const email = process.argv.find((argument) => argument.startsWith('--email='))?.slice('--email='.length).trim().toLowerCase();
if (!email) throw new Error('Pass --email=<exact-email>.');

try {
  const user = await getUserByEmailHash(await hashUserEmail(email));
  if (!user) throw new Error(`No user exists for ${email}.`);
  const context = await getPersonalAuthContext(user.key);
  if (!context) throw new Error(`No personal workspace exists for ${email}.`);
  await initialWorkspaceContentService.ensure(context.scope.key);
  const cursor = await db.query<{ name: string; mutationPolicy: string; imageCount: number }>(
    `FOR collection IN collections
      FILTER collection.scopeKey == @scopeKey && LOWER(collection.name) == 'vorinthex ai'
      LET imageCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == collection._key RETURN 1)
      RETURN { name: collection.name, mutationPolicy: collection.mutationPolicy, imageCount }`,
    { scopeKey: context.scope.key },
  );
  const [collection] = await cursor.all();
  if (!collection || collection.mutationPolicy !== 'user' || collection.imageCount !== 39) throw new Error('Initial Gallery collection verification failed.');
  console.log(JSON.stringify({ email, scopeKey: context.scope.key, collection }));
} finally {
  await closeDb();
}
