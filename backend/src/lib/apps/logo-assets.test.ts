import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { APP_LOGO_MANIFEST } from './logo-manifest';
import { APP_LOGO_CACHE_CONTROL, seedAppLogoAssets } from './logo-assets';

describe('app logo system asset seeder', () => {
  test('uploads checksummed PNGs once and skips unchanged objects via HeadObject', async () => {
    const stored = new Map<string, { Metadata: Record<string, string>; ContentType: string; CacheControl: string }>();
    const commands: Array<HeadObjectCommand | PutObjectCommand> = [];
    const client = {
      send: async (command: HeadObjectCommand | PutObjectCommand) => {
        commands.push(command);
        if (command instanceof HeadObjectCommand) {
          const value = stored.get(command.input.Key!);
          if (!value) throw Object.assign(new Error('missing'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
          return value;
        }
        stored.set(command.input.Key!, {
          Metadata: command.input.Metadata!,
          ContentType: command.input.ContentType!,
          CacheControl: command.input.CacheControl!,
        });
        expect(command.input.ChecksumSHA256).toBeString();
        expect(command.input.Metadata?.sha256).toMatch(/^[a-f0-9]{64}$/);
        return {};
      },
    };
    const repositoryRoot = resolve(import.meta.dir, '../../../../');

    const first = await seedAppLogoAssets({ client: client as never, bucket: 'logos', repositoryRoot });
    const second = await seedAppLogoAssets({ client: client as never, bucket: 'logos', repositoryRoot });

    expect(first.every(({ status }) => status === 'uploaded')).toBe(true);
    expect(second.every(({ status }) => status === 'unchanged')).toBe(true);
    expect(commands.filter((command) => command instanceof PutObjectCommand)).toHaveLength(Object.keys(APP_LOGO_MANIFEST).length);
    expect(stored.values().next().value).toMatchObject({ ContentType: 'image/png', CacheControl: APP_LOGO_CACHE_CONTROL });
  });
});
