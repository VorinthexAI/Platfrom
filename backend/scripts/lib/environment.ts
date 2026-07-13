import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import type { Interface } from 'node:readline/promises';
import { selectMenu } from './menu';

export type EnvironmentName = 'dev' | 'prod';
const DEFAULT_PROD_SSH_USER = 'ec2-user';
const DEFAULT_PROD_SSH_HOST = '16.192.25.45';
const DEFAULT_REMOTE_ARANGO_HOST = '127.0.0.1';
const DEFAULT_LOCAL_TUNNEL_PORT = 8529;
const ENVIRONMENTS_JSON_PATH = fileURLToPath(new URL('../../../.github/environments.json', import.meta.url));
const TERRAFORM_PROD_DIR = fileURLToPath(new URL('../../../terraform/environments/production', import.meta.url));
let prodSshTunnel: ChildProcess | null = null;

export async function chooseEnvironment(rl: Interface): Promise<EnvironmentName> {
  rl.pause();
  const environment = (await selectMenu<EnvironmentName>('Select environment', [
    { label: 'dev', value: 'dev' },
    { label: 'prod', value: 'prod' },
  ])) ?? 'dev';
  rl.resume();
  return environment;
}

function loadEnvironmentSection(environment: EnvironmentName): Record<string, unknown> | null {
  if (!existsSync(ENVIRONMENTS_JSON_PATH)) return null;
  const parsed = JSON.parse(readFileSync(ENVIRONMENTS_JSON_PATH, 'utf8'));
  const section = environment === 'dev' ? parsed?.secrets?.dev?.backend : parsed?.secrets?.prod?.env;
  return section && typeof section === 'object' ? section : null;
}

export function loadEnvironment(environment: EnvironmentName) {
  const section = loadEnvironmentSection(environment);
  if (section) {
    for (const [key, value] of Object.entries(section)) {
      if (typeof value === 'string' && value !== '') process.env[key] = value;
    }
    console.log(`Loaded secrets.${environment}.${environment === 'dev' ? 'backend' : 'env'} from .github/environments.json`);
    return ENVIRONMENTS_JSON_PATH;
  }

  if (environment === 'prod') {
    throw new Error('.github/environments.json is missing, still git-crypt encrypted, or has no secrets.prod.env section. Run `git-crypt unlock` first.');
  }

  console.log('.github/environments.json not found or has no secrets.dev.backend section. Using current process environment.');
  return null;
}

function isPrivateHost(hostname: string) {
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) return false;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  const match = hostname.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function isLocalHost(hostname: string) {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function hasProdTunnelConfig() {
  return Boolean(
    process.env.PROD_ARANGO_SSH_HOST
      || process.env.GRAPH_DB_EC2_HOST
      || process.env.PROD_SSH_HOST,
  );
}

function waitForPort(host: string, port: number, timeoutMs = 10_000) {
  const startedAt = Date.now();

  return new Promise<void>((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host, port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', (error) => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(error);
          return;
        }
        setTimeout(attempt, 250);
      });
    };

    attempt();
  });
}

async function canConnectToPort(host: string, port: number) {
  try {
    await waitForPort(host, port, 750);
    return true;
  } catch {
    return false;
  }
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, '\n').trimEnd() + '\n';
}

function decodeBase64PrivateKey(value: string) {
  try {
    const decoded = Buffer.from(value.replace(/\s+/g, ''), 'base64').toString('utf8');
    return isPrivateKey(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function isPrivateKey(value: string) {
  return value.includes('-----BEGIN') && value.includes('PRIVATE KEY-----');
}

function writePrivateKey(path: string, privateKey: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, normalizePrivateKey(privateKey), { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may not fully honor POSIX modes; OpenSSH accepts the file ACL in normal user profiles.
  }
}

function materializeSshKey(path: string) {
  if (existsSync(path)) return;

  const envKey = process.env.PROD_SSH_PRIVATE_KEY
    ?? process.env.GRAPH_DB_EC2_SSH_KEY
    ?? process.env.GRAPH_DB_SSH_KEY
    ?? process.env.APP_EC2_SSH_KEY
    ?? process.env.EC2_SSH_KEY;
  if (envKey && isPrivateKey(envKey)) {
    writePrivateKey(path, envKey);
    console.log(`Wrote SSH key from environment to ${path}`);
    return;
  }

  const envKeyB64 = process.env.PROD_SSH_PRIVATE_KEY_B64
    ?? process.env.GRAPH_DB_EC2_SSH_KEY_B64
    ?? process.env.GRAPH_DB_SSH_KEY_B64
    ?? process.env.APP_EC2_SSH_KEY_B64
    ?? process.env.EC2_SSH_KEY_B64;
  const decodedEnvKey = envKeyB64 ? decodeBase64PrivateKey(envKeyB64) : null;
  if (decodedEnvKey) {
    writePrivateKey(path, decodedEnvKey);
    console.log(`Wrote SSH key from base64 environment key to ${path}`);
    return;
  }

  const output = spawnSync('terraform', [
    `-chdir=${TERRAFORM_PROD_DIR}`,
    'output',
    '-raw',
    'graph_db_ec2_ssh_private_key',
  ], { encoding: 'utf8', windowsHide: true });
  if (output.status === 0 && isPrivateKey(output.stdout)) {
    writePrivateKey(path, output.stdout);
    console.log(`Wrote SSH key from Terraform output to ${path}`);
    return;
  }

  const detail = (output.stderr || output.stdout).trim();
  throw new Error([
    `SSH key file is missing: ${path}`,
    'Unable to auto-create it from PROD_SSH_PRIVATE_KEY, GRAPH_DB_EC2_SSH_KEY, APP_EC2_SSH_KEY, EC2_SSH_KEY, their *_B64 variants, or Terraform output.',
    `Fix: run \`terraform -chdir=terraform/environments/production output -raw graph_db_ec2_ssh_private_key > "${path}"\` from the repo root with AWS credentials configured, then rerun \`bun run nodes\`.`,
    detail ? `Terraform output error:\n${detail}` : '',
  ].filter(Boolean).join('\n'));
}

async function openProdArangoTunnel(arangoUrl: URL) {
  if (prodSshTunnel) return;

  const sshUser = process.env.PROD_SSH_USER ?? DEFAULT_PROD_SSH_USER;
  const sshHost = process.env.PROD_ARANGO_SSH_HOST
    ?? process.env.GRAPH_DB_EC2_HOST
    ?? process.env.PROD_SSH_HOST
    ?? DEFAULT_PROD_SSH_HOST;
  const sshKey = process.env.PROD_SSH_KEY_PATH;
  const remoteArangoHost = process.env.PROD_ARANGO_REMOTE_HOST ?? DEFAULT_REMOTE_ARANGO_HOST;
  const localPort = Number(process.env.PROD_ARANGO_LOCAL_PORT ?? DEFAULT_LOCAL_TUNNEL_PORT);
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
    throw new Error('PROD_ARANGO_LOCAL_PORT must be a valid TCP port.');
  }

  const args = [
    '-N',
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-L',
    `127.0.0.1:${localPort}:${remoteArangoHost}:${arangoUrl.port || '8529'}`,
    `${sshUser}@${sshHost}`,
  ];
  if (sshKey) {
    materializeSshKey(sshKey);
    args.unshift('-i', sshKey);
  }

  console.log(`Opening prod ArangoDB SSH tunnel 127.0.0.1:${localPort} -> ${remoteArangoHost}:${arangoUrl.port || '8529'} via ${sshUser}@${sshHost}...`);
  const tunnel = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  prodSshTunnel = tunnel;

  let stderr = '';
  tunnel.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  tunnel.once('exit', (code, signal) => {
    if (prodSshTunnel) {
      console.error(`Prod SSH tunnel exited early (${signal ?? code ?? 'unknown'}).`);
      if (stderr.trim()) console.error(stderr.trim());
    }
    prodSshTunnel = null;
  });

  try {
    await waitForPort('127.0.0.1', localPort);
  } catch (error) {
    closeProdSshTunnel();
    const detail = stderr.trim() ? `\nssh stderr:\n${stderr.trim()}` : '';
    throw new Error(`Failed to open prod ArangoDB SSH tunnel. Make sure SSH access to ${sshUser}@${sshHost} works.${detail}`, { cause: error });
  }

  const tunneledUrl = new URL(arangoUrl.toString());
  tunneledUrl.hostname = '127.0.0.1';
  tunneledUrl.port = String(localPort);
  process.env.ARANGO_URL = tunneledUrl.toString();
  console.log(`Using tunneled ARANGO_URL=${process.env.ARANGO_URL}`);
}

export async function verifyProdDatabaseConnection() {
  await verifyDatabaseConnection('prod');
}

export async function verifyDatabaseConnection(environment: EnvironmentName) {
  if (!process.env.ARANGO_URL) {
    throw new Error(`${environment} selected but ARANGO_URL is not set.`);
  }

  const arangoUrl = new URL(process.env.ARANGO_URL);
  const arangoPort = Number(arangoUrl.port || 8529);
  const shouldTunnelPrivateProd = environment === 'prod' && isPrivateHost(arangoUrl.hostname);
  const shouldTunnelLocalUrl = isLocalHost(arangoUrl.hostname)
    && hasProdTunnelConfig()
    && !(await canConnectToPort(arangoUrl.hostname, arangoPort));

  if (shouldTunnelPrivateProd || shouldTunnelLocalUrl) {
    await openProdArangoTunnel(arangoUrl);
  }

  const { db } = await import('@/lib/db/client');
  await db.version();
  console.log(`Verified ${environment} database connection to ${new URL(process.env.ARANGO_URL).hostname}.`);
}

export function closeProdSshTunnel() {
  if (!prodSshTunnel) return;
  const tunnel = prodSshTunnel;
  prodSshTunnel = null;
  tunnel.kill();
}
