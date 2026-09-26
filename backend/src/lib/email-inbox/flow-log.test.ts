import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

afterEach(() => {
  delete process.env.EMAIL_FLOW_LOG_PATH;
});

test('writes sanitized email flow events to the configured txt file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'email-flow-'));
  const path = join(directory, 'vorinthex-email-flow.txt');
  process.env.EMAIL_FLOW_LOG_PATH = path;
  const { logEmailFlow } = await import('./flow-log');
  logEmailFlow('oauth.callback.failed', { accessToken: 'secret-token', error: new Error('watch rejected'), connectorKey: 'conn-1' });
  await Bun.sleep(50);
  const contents = await readFile(path, 'utf8');
  expect(contents).toContain('"event":"oauth.callback.failed"');
  expect(contents).toContain('"connectorKey":"conn-1"');
  expect(contents).not.toContain('secret-token');
  expect(contents).toContain('[redacted]');
  await rm(directory, { recursive: true, force: true });
});
