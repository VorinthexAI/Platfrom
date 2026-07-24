import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { ARCHIVE_TOOL_NAMES, domainToolInputSchemas, TOOL_DEFINITIONS, TOOL_NAMES } from './index';

describe('unified tool registry', () => {
  test('has one unique definition for every public tool name', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    expect(new Set(TOOL_DEFINITIONS.map(({ name }) => name)).size).toBe(TOOL_DEFINITIONS.length);
    expect(TOOL_NAMES).toHaveLength(131);
    expect(TOOL_DEFINITIONS).toHaveLength(131);
    expect(TOOL_DEFINITIONS).toHaveLength(ARCHIVE_TOOL_NAMES.length + 96);
    expect(TOOL_DEFINITIONS.map(({ name }) => name)).toEqual([...TOOL_NAMES]);
    expect(TOOL_NAMES.filter((name) => name === 'chat')).toHaveLength(1);
    expect(TOOL_NAMES).not.toContain('orchestrator.chat');
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'chat')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.some(({ name }) => name === 'orchestrator.chat')).toBe(false);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'folder.archive')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'document.restore')).toHaveLength(1);
  });

  test('retains the historical lifecycle batch input for colliding names', () => {
    expect(domainToolInputSchemas['folder.archive'].parse({ items: [{ folderKey: newId() }], atomic: true })).toMatchObject({ atomic: true });
    expect(domainToolInputSchemas['document.restore'].parse({ items: [{ documentKey: newId() }] })).toMatchObject({ atomic: true });
  });
});
