import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chooseEnvironment, closeProdSshTunnel, loadEnvironment, verifyProdDatabaseConnection } from './lib/environment';
import { selectMenu } from './lib/menu';

const rl = createInterface({ input, output });

async function acceptUsers() {
  const { acceptWaitlistUser, listPendingWaitlistUsers } = await import('@/platform/waitlist');
  const pending = await listPendingWaitlistUsers();

  if (pending.length === 0) {
    console.log('\nPending users: 0');
    return;
  }

  const user = await selectMenu(`Pending users: ${pending.length}`, pending.map((user) => ({
    label: user.email,
    value: user,
    hint: user.isVerified ? '' : '(unverified)',
  })), { cancelValue: 'q' });

  if (!user) return;
  const accepted = await acceptWaitlistUser(user.id);
  if (!accepted) {
    console.log('User no longer exists.');
    return;
  }
  console.log(`Accepted ${accepted.email}.`);
  console.log(`Sent sign-in email that expires at ${accepted.expires_at?.toISOString() ?? 'unknown'}.`);
}

async function printWaitlistUsers() {
  const { listPendingWaitlistUsers } = await import('@/platform/waitlist');
  const users = await listPendingWaitlistUsers();

  if (users.length === 0) {
    console.log('\nWaitlist users: 0');
    return;
  }

  const rows = users.map((user) => ({
    name: user.name?.trim() || '-',
    email: user.email,
    verified: user.isVerified,
  }));
  const nameWidth = Math.max('Name'.length, ...rows.map((row) => row.name.length));
  const emailWidth = Math.max('Email'.length, ...rows.map((row) => row.email.length));

  console.log('\nWaitlist users');
  console.log(`${'Name'.padEnd(nameWidth)}  ${'Email'.padEnd(emailWidth)}`);
  console.log(`${'-'.repeat(nameWidth)}  ${'-'.repeat(emailWidth)}`);
  for (const row of rows) {
    console.log(`${row.name.padEnd(nameWidth)}  ${row.email.padEnd(emailWidth)}`);
  }

  const verifiedCount = rows.filter((row) => row.verified).length;
  console.log(`\nTotal: ${rows.length}`);
  console.log(`Verified: ${verifiedCount}`);
  console.log(`Unverified: ${rows.length - verifiedCount}`);
}

async function optionsMenu() {
  while (true) {
    const action = await selectMenu<'approve' | 'print' | 'exit'>('Waitlist management', [
      { label: 'Approve one pending user and send sign-in email', value: 'approve' },
      { label: 'Print waitlist users', value: 'print', hint: 'name and email only' },
      { label: 'Exit', value: 'exit' },
    ]);
    if (action === 'approve') await acceptUsers();
    else if (action === 'print') await printWaitlistUsers();
    else return;
  }
}

async function main() {
  const command = Bun.argv[2];
  if (command && command !== 'waitlist') {
    console.log('Usage: bun run manage waitlist');
    process.exitCode = 1;
    return;
  }

  const environment = await chooseEnvironment(rl);
  rl.pause();
  loadEnvironment(environment);
  if (environment === 'prod') await verifyProdDatabaseConnection();

  try {
    await optionsMenu();
  } finally {
    const { closeDb } = await import('@/lib/db/client');
    await closeDb();
    closeProdSshTunnel();
    rl.close();
  }
}

await main();
