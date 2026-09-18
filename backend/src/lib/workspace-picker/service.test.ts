import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createWorkspacePickerService, WorkspacePickerError, workspacePickerUpdateInputSchema } from './service';
import type { WorkspacePickerRepository, WorkspacePickerScope } from './repository';

const archive = { key: newId(), slug: 'archive' as const, name: 'Archive', visibility: 'public' as const };
const gallery = { key: newId(), slug: 'gallery' as const, name: 'Gallery', visibility: 'public' as const };
const signal = { key: newId(), slug: 'signal' as const, name: 'Signal', visibility: 'public' as const };
const hq = { key: newId(), slug: 'hq' as const, name: 'HQ', visibility: 'private' as const };

function repository(scopes: WorkspacePickerScope[], stored: string[] = []): WorkspacePickerRepository & { stored: string[] } {
  const state = { stored: [...stored] };
  return {
    get stored() { return state.stored; },
    listRootPickerScopes: async () => scopes,
    listUserScopeKeys: async () => state.stored,
    replaceUserScopeKeys: async (_userKey, scopeKeys) => { state.stored = [...scopeKeys]; return state.stored; },
  };
}

describe('workspace picker service', () => {
  test('treats an empty join as unset and hides HQ from non-founders', async () => {
    const repo = repository([archive, gallery, signal, hq]);
    await expect(createWorkspacePickerService(repo, async () => false).read('user-1')).resolves.toEqual({
      apps: [
        { scopeKey: archive.key, slug: 'archive', name: 'Archive' },
        { scopeKey: gallery.key, slug: 'gallery', name: 'Gallery' },
        { scopeKey: signal.key, slug: 'signal', name: 'Signal' },
      ],
      selectedScopeKeys: null,
    });
    await expect(createWorkspacePickerService(repo, async () => true).read('user-1')).resolves.toMatchObject({
      apps: expect.arrayContaining([{ scopeKey: hq.key, slug: 'hq', name: 'HQ' }]),
      selectedScopeKeys: null,
    });
  });

  test('replaces the allowlist with entitled root-team picker scopes only', async () => {
    const repo = repository([archive, gallery, signal, hq]);
    const member = createWorkspacePickerService(repo, async () => false);
    const founder = createWorkspacePickerService(repo, async () => true);
    const updated = await member.update('user-1', [signal.key]);
    expect(updated.selectedScopeKeys).toEqual([signal.key]);
    expect(repo.stored).toEqual([signal.key]);
    await expect(member.update('user-1', [hq.key])).rejects.toBeInstanceOf(WorkspacePickerError);
    await expect(founder.update('user-1', [hq.key])).resolves.toMatchObject({ selectedScopeKeys: [hq.key] });
  });

  test('rejects unknown fields and empty allowlists', () => {
    expect(workspacePickerUpdateInputSchema.parse({ scopeKeys: [archive.key] })).toEqual({ scopeKeys: [archive.key] });
    expect(() => workspacePickerUpdateInputSchema.parse({ scopeKeys: [archive.key], userKey: 'forged' })).toThrow('Unrecognized key');
    expect(() => workspacePickerUpdateInputSchema.parse({ scopeKeys: [] })).toThrow();
  });
});
