import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createWorkspacePickerService, WorkspacePickerError, workspacePickerUpdateInputSchema } from './service';
import type { WorkspacePickerRepository, WorkspacePickerScope } from './repository';

const archive = { key: newId(), slug: 'archive' as const, name: 'Archive', visibility: 'public' as const };
const gallery = { key: newId(), slug: 'gallery' as const, name: 'Gallery', visibility: 'public' as const };
const signal = { key: newId(), slug: 'signal' as const, name: 'Signal', visibility: 'public' as const };
const hq = { key: newId(), slug: 'hq' as const, name: 'HQ', visibility: 'private' as const };
const hidden = { key: newId(), slug: 'ascend' as const, name: 'Core', visibility: 'hidden' as const };

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
  test('treats an empty join as unset and hides private and hidden scopes', async () => {
    const repo = repository([archive, gallery, signal, hq, hidden]);
    await expect(createWorkspacePickerService(repo).read('user-1')).resolves.toEqual({
      apps: [
        { scopeKey: archive.key, slug: 'archive', name: 'Archive' },
        { scopeKey: gallery.key, slug: 'gallery', name: 'Gallery' },
        { scopeKey: signal.key, slug: 'signal', name: 'Signal' },
      ],
      selectedScopeKeys: null,
    });
  });

  test('replaces the allowlist with public picker scopes only', async () => {
    const repo = repository([archive, gallery, signal, hq, hidden]);
    const picker = createWorkspacePickerService(repo);
    const updated = await picker.update('user-1', [signal.key]);
    expect(updated.selectedScopeKeys).toEqual([signal.key]);
    expect(repo.stored).toEqual([signal.key]);
    await expect(picker.update('user-1', [hq.key])).rejects.toBeInstanceOf(WorkspacePickerError);
    await expect(picker.update('user-1', [hidden.key])).rejects.toBeInstanceOf(WorkspacePickerError);
  });

  test('rejects unknown fields and empty allowlists', () => {
    expect(workspacePickerUpdateInputSchema.parse({ scopeKeys: [archive.key] })).toEqual({ scopeKeys: [archive.key] });
    expect(() => workspacePickerUpdateInputSchema.parse({ scopeKeys: [archive.key], userKey: 'forged' })).toThrow('Unrecognized key');
    expect(() => workspacePickerUpdateInputSchema.parse({ scopeKeys: [] })).toThrow();
    expect(() => workspacePickerUpdateInputSchema.parse({ scopeKeys: [archive.key, gallery.key, signal.key, newId(), newId(), newId()] })).toThrow();
  });
});
