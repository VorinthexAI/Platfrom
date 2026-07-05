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
    const { upsertUserByEmail } = await import('@/api/users');
    const { upsertMemberForUser } = await import('@/api/users');
    const { updateMember } = await import('@/lib/db/members.node');
    const { encryptSecret } = await import('@/lib/crypto');
    const { verifySuccessiveTotpCodes } = await import('@/api/auth');

    const email = await askEmail();

    console.log(`\nCreating/updating super admin user for ${email} in ${environment}...`);
    const user = await upsertUserByEmail(email, {
      isVerified: true,
    });
    const member = await upsertMemberForUser(user, { isSuperAdmin: true });
    console.log(`User ${user.key} and member ${member.key} ready.`);

    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer: ISSUER, label: user.email, secret });
    const qr = await QRCode.toString(otpauthUrl, { type: 'terminal', small: true });

    console.log('\nScan this QR code with your authenticator app:\n');
    console.log(qr);
    console.log(`Can't scan? Enter this secret manually: ${secret}`);
    console.log(`otpauth URL: ${otpauthUrl}`);

    const lastTotpTimeStep = await verifyTwoCodes(secret, verifySuccessiveTotpCodes);

    await updateMember(member.key, {
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
