import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { config as loadEnv } from 'dotenv';
import type { Interface } from 'node:readline/promises';
import { selectMenu } from './menu';

export type EnvironmentName = 'dev' | 'prod';
const DEFAULT_PROD_SSH_USER = 'ec2-user';
const DEFAULT_PROD_SSH_HOST = '16.192.25.45';
const DEFAULT_REMOTE_ARANGO_HOST = '127.0.0.1';
const DEFAULT_LOCAL_TUNNEL_PORT = 8529;
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

function resolveEnvironmentFile(environment: EnvironmentName) {
  const candidates = environment === 'dev'
    ? ['../environments/backend/.env.dev']
    : ['../environments/backend/.env.prod', '../environments/backend/.env.production'];

  return candidates.find((file) => existsSync(file));
}

export function loadEnvironment(environment: EnvironmentName) {
  const envFile = resolveEnvironmentFile(environment);
  if (envFile) {
    loadEnv({ path: envFile, override: true });
    console.log(`Loaded ${envFile}`);
    return envFile;
  }

  if (environment === 'prod') {
    throw new Error('No environments/backend/.env.prod or environments/backend/.env.production file found. Copy environments/backend/.env.example to environments/backend/.env.prod and set ARANGO_URL.');
  }

  console.log('No environments/backend/.env.dev file found. Using current process environment.');
  return null;
}

function isPrivateHost(hostname: string) {
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) return false;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  const match = hostname.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
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
    '-L',
    `127.0.0.1:${localPort}:${remoteArangoHost}:${arangoUrl.port || '8529'}`,
    `${sshUser}@${sshHost}`,
  ];
  if (sshKey) args.unshift('-i', sshKey);

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
  if (!process.env.ARANGO_URL) {
    throw new Error('Prod selected but ARANGO_URL is not set.');
  }

  const arangoUrl = new URL(process.env.ARANGO_URL);
  if (isPrivateHost(arangoUrl.hostname)) {
    await openProdArangoTunnel(arangoUrl);
  }

  const { db } = await import('@/lib/db/client');
  await db.version();
  console.log(`Verified prod database connection to ${new URL(process.env.ARANGO_URL).hostname}.`);
}

export function closeProdSshTunnel() {
  if (!prodSshTunnel) return;
  const tunnel = prodSshTunnel;
  prodSshTunnel = null;
  tunnel.kill();
}
