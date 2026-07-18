import { streamFoundersBeaconAsk } from '../src/lib/ai/agents/beacon/ask';
import { getRootOrganization } from '../src/lib/db/organizations.node';
import { getUserByEmail } from '../src/lib/db/users.node';
import { getUserOrganizationByOrganizationAndUser } from '../src/lib/db/user-organization.node';
import { closeDb } from '../src/lib/db/client';
import { listAccessibleScopes, requireScopeAccess } from '../src/lib/founders/access';

async function main() {
  const rootOrganization = await getRootOrganization();
  if (!rootOrganization) throw new Error('Beacon smoke: root organization not found');
  const email = process.env.ADMIN_EMAIL?.trim() || 'oscar@vorinthex.com';
  const user = await getUserByEmail(email);
  if (!user) throw new Error(`Beacon smoke: founder ${email} not found`);
  const membership = await getUserOrganizationByOrganizationAndUser(rootOrganization.key, user.key);
  if (!membership || membership.status !== 'active') throw new Error(`Beacon smoke: founder ${email} has no active root membership`);
  const scopeOption = (await listAccessibleScopes(membership))[0];
  if (!scopeOption) throw new Error('Beacon smoke: no selectable leaf scope found');
  const { scope } = await requireScopeAccess(membership, scopeOption.key);

  let response = '';
  let completed = false;
  for await (const event of streamFoundersBeaconAsk({ organization: rootOrganization, scope, membership, user, message: 'hey' })) {
    if (event.type === 'delta') response += event.text;
    if (event.type === 'completed') completed = true;
  }
  if (!completed || response.trim().length === 0) throw new Error('Beacon smoke: provider returned no completed text response');
  console.info('Beacon smoke passed', { scope: scope.slug, responseCharacters: response.length });
}

try {
  await main();
} finally {
  await closeDb();
}
