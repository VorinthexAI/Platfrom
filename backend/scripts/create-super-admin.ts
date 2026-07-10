import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { z } from 'zod';
import QRCode from 'qrcode';
import { generateSecret, generateURI } from 'otplib';
import { chooseEnvironment, closeProdSshTunnel, loadEnvironment, verifyProdDatabaseConnection } from './lib/environment';

const ISSUER = 'Vorinthex';

const rl = createInterface({ input, output });

async function ask(question: string) {
  return (await rl.question(question)).trim();
}

async function askEmail(): Promise<string> {
  while (true) {
    const raw = await ask('\nSuper admin email> ');
    const parsed = z.string().email().safeParse(raw.toLowerCase());
    if (parsed.success) return parsed.data;
    console.log('Enter a valid email address.');
  }
}

async function verifyTwoCodes(secret: string, verifySuccessiveTotpCodes: (secret: string, codes: [string, string]) => Promise<number | null>): Promise<number> {
  while (true) {
    const code1 = await ask('\nEnter the current 6-digit code from your authenticator app> ');
    console.log('Wait for the app to show a new code (~30s), then enter it.');
    const code2 = await ask('Enter the next 6-digit code> ');
    const timeStep = await verifySuccessiveTotpCodes(secret, [code1, code2]);
    if (timeStep !== null) return timeStep;
    console.log('Those two codes were not valid/sequential — please try again.');
  }
}

async function main() {
  const environment = await chooseEnvironment(rl);
  loadEnvironment(environment);
  if (environment === 'prod') await verifyProdDatabaseConnection();

  try {
    const { hashUserEmail } = await import('@/api/users');
    const { getUserByEmailHash, insertUser, updateUser } = await import('@/lib/db/users.node');
    const { encryptSecret } = await import('@/lib/crypto');
    const { newId } = await import('@/lib/ids');
    const { getRootOrganizationId } = await import('@/platform/events');
    const { verifySuccessiveTotpCodes } = await import('@/api/auth');

    const email = await askEmail();

    console.log(`\nCreating/updating super admin identity for ${email} in ${environment}...`);
    const emailHash = await hashUserEmail(email);
    const existingSuperAdmin = await getUserByEmailHash(emailHash);
    const now = new Date().toISOString();
    const superAdmin = existingSuperAdmin ?? await insertUser({
      key: newId(),
      organizationId: await getRootOrganizationId(),
      email,
      emailHash,
      name: null,
      profileUrl: null,
      alias: null,
      alias_slug: null,
      organization_role: 'owner',
      waitlistNumber: null,
      isVerified: true,
      is_subscribed_to_updates: true,
      is_subscribed_to_updates_unsubscribe_token_hash: null,
      is_subscribed_to_updates_unsubscribe_requested_at: null,
      isMfaEnabled: false,
      has_request_mfa_reset_link: false,
      totpSecret: null,
      lastTotpTimeStep: null,
      requested_mfa_reset_link_at: null,
      refreshTokenHash: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });
    if (existingSuperAdmin && existingSuperAdmin.organization_role !== 'owner') {
      await updateUser(existingSuperAdmin.key, { organization_role: 'owner', updatedAt: now });
    }
    const superAdminKey = superAdmin.key;
    console.log(`Super admin identity ${superAdminKey} ready.`);

    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer: ISSUER, label: email, secret });
    const qr = await QRCode.toString(otpauthUrl, { type: 'terminal', small: true });

    console.log('\nScan this QR code with your authenticator app:\n');
    console.log(qr);
    console.log(`Can't scan? Enter this secret manually: ${secret}`);
    console.log(`otpauth URL: ${otpauthUrl}`);

    const lastTotpTimeStep = await verifyTwoCodes(secret, verifySuccessiveTotpCodes);

    await updateUser(superAdminKey, {
      totpSecret: await encryptSecret(secret),
      isMfaEnabled: true,
      lastTotpTimeStep,
      updatedAt: new Date().toISOString(),
    });

    console.log(`\nSuper admin ${email} is ready with MFA enabled in ${environment}.`);
  } finally {
    const { closeDb } = await import('@/lib/db/client');
    await closeDb();
    closeProdSshTunnel();
    rl.close();
  }
}

await main();
