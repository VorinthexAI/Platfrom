import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import {
  ARCHIVE_ERROR_CODES,
  ARCHIVE_TOOL_DEFINITIONS,
  ARCHIVE_TOOL_NAMES,
  archiveBatchOutputSchema,
  archiveToolInputSchemas,
  archiveToolOutputSchemas,
  isArchiveToolName,
} from './index';

const expectedNames = [
  'folder.create', 'folder.find', 'folder.list', 'folder.update', 'folder.rename', 'folder.move', 'folder.archive', 'folder.restore', 'folder.delete',
  'document.processing', 'document.find', 'document.list', 'document.read', 'document.update', 'document.rename', 'document.move', 'document.copy', 'document.archive', 'document.restore', 'document.delete', 'document.download', 'document.export', 'document.share', 'document.unshare', 'document.list-shares', 'document.create-version', 'document.find-version', 'document.list-versions', 'document.restore-version', 'document.delete-version', 'document.summarize', 'document.translate', 'document.rewrite',
  'scope.document.search', 'organization.document.search',
] as const;

describe('Archive tool registry', () => {
  test('contains exactly the 35 dotted names and no action-style kebab names', () => {
    expect([...ARCHIVE_TOOL_NAMES]).toEqual([...expectedNames]);
    expect(ARCHIVE_TOOL_NAMES).toHaveLength(35);
    for (const name of ARCHIVE_TOOL_NAMES) {
      expect(name).toMatch(/^[a-z]+(?:[.-][a-z]+)*$/);
      expect(name).toContain('.');
      expect(name).not.toMatch(/^[a-z]+-[a-z-]+$/);
      expect(isArchiveToolName(name)).toBe(true);
    }
    expect(isArchiveToolName('document-create-version')).toBe(false);
  });

  test('derives strict provider metadata from every registered contract', () => {
    expect(ARCHIVE_TOOL_DEFINITIONS.map((definition) => definition.name)).toEqual([...expectedNames]);
    for (const definition of ARCHIVE_TOOL_DEFINITIONS) {
      expect(definition.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(definition.outputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    }
  });
});

describe('Archive input contracts', () => {
  const key = newId();

  test('applies atomic and mode defaults, including nested restore defaults', () => {
    expect(archiveToolInputSchemas['folder.update'].parse({ updates: [{ folderKey: key, name: 'Renamed' }] }).atomic).toBe(false);
    expect(archiveToolInputSchemas['document.read'].parse({ documentKeys: [key] })).toMatchObject({ mode: 'content', atomic: false });
    expect(archiveToolInputSchemas['document.download'].parse({ documentKeys: [key] }).format).toBe('original');
    expect(archiveToolInputSchemas['document.translate'].parse({ documentKeys: [key], targetLanguage: 'French' })).toMatchObject({ mode: 'preview', atomic: false });
    expect(archiveToolInputSchemas['document.rewrite'].parse({ rewrites: [{ documentKey: key, instruction: 'Clarify' }] })).toMatchObject({ atomic: false, rewrites: [{ mode: 'preview' }] });
    expect(archiveToolInputSchemas['document.restore-version'].parse({ restores: [{ documentKey: key, versionKey: newId() }] })).toMatchObject({ atomic: false, restores: [{ createBackupVersion: true }] });
    expect(archiveToolInputSchemas['document.copy'].parse({ copies: [{ documentKey: key, targetFolderKey: newId() }] })).toMatchObject({ atomic: false, copies: [{ includeVersions: false, includeShares: false }] });
  });

  test('preserves specified optional controls', () => {
    expect(archiveToolInputSchemas['folder.restore'].parse({ folderKeys: [key], restoreAncestors: true })).toMatchObject({ restoreAncestors: true });
    expect(archiveToolInputSchemas['document.read'].parse({ documentKeys: [key], mode: 'audio', includeCode: true, persistAudio: true })).toMatchObject({ includeCode: true, persistAudio: true });
    expect(archiveToolInputSchemas['document.summarize'].parse({ documentKeys: [key], combine: true })).toMatchObject({ combine: true });
    expect(archiveToolInputSchemas['folder.update'].parse({ updates: [{ folderKey: key, description: null }] })).toMatchObject({ updates: [{ description: null }] });
    expect(archiveToolInputSchemas['document.delete'].parse({ documentKeys: [key], deleteVersions: true, deleteShares: true })).toMatchObject({ deleteVersions: true, deleteShares: true });
  });

  test('rejects unknown properties and invalid enum, score, and range values', () => {
    expect(() => archiveToolInputSchemas['folder.find'].parse({ folderKeys: [key], surprise: true })).toThrow();
    expect(() => archiveToolInputSchemas['document.download'].parse({ documentKeys: [key], format: 'pdf' })).toThrow();
    expect(() => archiveToolInputSchemas['scope.document.search'].parse({ scopeKey: key, query: 'roadmap', minimumScore: 1.1 })).toThrow();
    expect(() => archiveToolInputSchemas['document.read'].parse({ documentKeys: [key], startOffset: 10, endOffset: 5 })).toThrow();
    expect(() => archiveToolInputSchemas['document.read'].parse({ documentKeys: [key], mode: 'content', voice: 'alloy' })).toThrow();
    expect(() => archiveToolInputSchemas['document.copy'].parse({ copies: [{ documentKey: key, targetFolderKey: newId(), name: 'Wrong field' }] })).toThrow();
    expect(archiveToolInputSchemas['scope.document.search'].parse({ scopeKey: key, query: 'roadmap', sources: [{ type: 'project', projectKeys: [newId()] }] })).toMatchObject({ sources: [{ type: 'project' }] });
  });

  test('enforces non-empty arrays for every batch-first contract', () => {
    const invalid: Array<[keyof typeof archiveToolInputSchemas, object]> = [
      ['folder.create', { folders: [] }], ['folder.update', { updates: [] }], ['folder.rename', { renames: [] }], ['folder.move', { moves: [] }],
      ['folder.archive', { folderKeys: [] }], ['folder.restore', { folderKeys: [] }], ['folder.delete', { folderKeys: [] }],
      ['document.find', { documentKeys: [] }], ['document.read', { documentKeys: [] }], ['document.update', { updates: [] }], ['document.rename', { renames: [] }],
      ['document.move', { moves: [] }], ['document.copy', { copies: [] }], ['document.archive', { documentKeys: [] }], ['document.restore', { documentKeys: [] }],
      ['document.delete', { documentKeys: [] }], ['document.download', { documentKeys: [] }], ['document.export', { exports: [] }], ['document.share', { shares: [] }],
      ['document.list-shares', { documentKeys: [] }], ['document.create-version', { documentKeys: [] }], ['document.find-version', { versionKeys: [] }],
      ['document.list-versions', { documentKeys: [] }], ['document.restore-version', { restores: [] }], ['document.delete-version', { versionKeys: [] }],
      ['document.summarize', { documentKeys: [] }], ['document.translate', { documentKeys: [], targetLanguage: 'French' }], ['document.rewrite', { rewrites: [] }],
    ];
    for (const [name, input] of invalid) expect(archiveToolInputSchemas[name].safeParse(input).success, name).toBe(false);
  });

  test('requires unshare selectors and rejects conflicting update representations', () => {
    expect(() => archiveToolInputSchemas['document.unshare'].parse({})).toThrow();
    expect(() => archiveToolInputSchemas['document.unshare'].parse({ shareKeys: [key], documentKeys: [newId()] })).toThrow();
    expect(() => archiveToolInputSchemas['document.update'].parse({ updates: [{ documentKey: key, html: '<p>x</p>', content: 'x' }] })).toThrow();
    expect(() => archiveToolInputSchemas['document.update'].parse({ updates: [{ documentKey: key, createVersion: true }] })).toThrow();
  });

  test('validates version label keys and lengths at the contract boundary', () => {
    expect(archiveToolInputSchemas['document.create-version'].parse({ documentKeys: [key], labels: { [key]: 'Release' } })).toMatchObject({ labels: { [key]: 'Release' } });
    expect(() => archiveToolInputSchemas['document.create-version'].parse({ documentKeys: [key], labels: { [newId()]: 'Wrong document' } })).toThrow();
    expect(() => archiveToolInputSchemas['document.create-version'].parse({ documentKeys: [key], labels: { [key]: 'x'.repeat(121) } })).toThrow();
  });

  test('accepts bounded idempotency keys on every potentially mutating contract', () => {
    const cases: Array<[keyof typeof archiveToolInputSchemas, Record<string, unknown>]> = [
      ['folder.create', { folders: [{ scopeKey: key, name: 'Folder' }] }],
      ['folder.update', { updates: [{ folderKey: key, name: 'Folder' }] }],
      ['folder.rename', { renames: [{ folderKey: key, name: 'Folder' }] }],
      ['folder.move', { moves: [{ folderKey: key }] }],
      ['folder.archive', { folderKeys: [key] }], ['folder.restore', { folderKeys: [key] }], ['folder.delete', { folderKeys: [key] }],
      ['document.update', { updates: [{ documentKey: key, content: 'text' }] }],
      ['document.rename', { renames: [{ documentKey: key, name: 'Name' }] }],
      ['document.move', { moves: [{ documentKey: key, targetFolderKey: newId() }] }],
      ['document.copy', { copies: [{ documentKey: key, targetFolderKey: newId() }] }],
      ['document.archive', { documentKeys: [key] }], ['document.restore', { documentKeys: [key] }], ['document.delete', { documentKeys: [key] }],
      ['document.share', { shares: [{ documentKey: key, permission: 'read' }] }],
      ['document.unshare', { shareKeys: [key] }], ['document.create-version', { documentKeys: [key] }],
      ['document.restore-version', { restores: [{ documentKey: key, versionKey: newId() }] }],
      ['document.delete-version', { versionKeys: [key] }], ['document.summarize', { documentKeys: [key] }],
      ['document.translate', { documentKeys: [key], targetLanguage: 'French' }],
      ['document.rewrite', { rewrites: [{ documentKey: key, instruction: 'Improve' }] }],
      ['document.read', { documentKeys: [key], mode: 'audio', persistAudio: true }],
    ];
    for (const [name, value] of cases) {
      expect(archiveToolInputSchemas[name].parse({ ...value, idempotencyKey: 'request-1' })).toMatchObject({ idempotencyKey: 'request-1' });
      expect(archiveToolInputSchemas[name].safeParse({ ...value, idempotencyKey: '' }).success).toBe(false);
    }
  });

  test('publishes provider-visible parity for file and cross-field constraints', () => {
    const definitions = Object.fromEntries(ARCHIVE_TOOL_DEFINITIONS.map((definition) => [definition.name, definition.inputSchema])) as Record<string, any>;
    expect(definitions['document.processing'].properties.file).toMatchObject({ type: 'object' });
    expect(definitions['document.unshare'].oneOf).toHaveLength(2);
    expect(definitions['document.update'].properties.updates.items.oneOf).toHaveLength(3);
    expect(definitions['document.read'].description).toContain('endOffset');
  });
});

describe('Archive output contracts', () => {
  test('requires deterministic strict search results and normalized scores', () => {
    const documentKey = newId();
    const scopeKey = newId();
    const folderKey = newId();
    const output = archiveToolOutputSchemas['scope.document.search'].parse({
      query: 'roadmap',
      results: [{ documentKey, name: 'Roadmap', scopeKey, folderKey, score: 0.9, matchedSource: { type: 'project', key: scopeKey }, scoreBreakdown: { vector: 0.9, lexical: 0.5, final: 0.8 } }],
      totalCandidates: 12,
    });
    expect(output).toMatchObject({ query: 'roadmap', results: [{ documentKey, scoreBreakdown: { vector: 0.9 } }], totalCandidates: 12 });
    expect(() => archiveToolOutputSchemas['scope.document.search'].parse({ query: 'roadmap', results: [], total: 0 })).toThrow();
    expect(() => archiveToolOutputSchemas['scope.document.search'].parse({ query: 'roadmap', results: [{ documentKey, name: 'Roadmap', scopeKey, folderKey, score: 2 }], totalCandidates: 1 })).toThrow();
    expect(() => archiveToolOutputSchemas['scope.document.search'].parse({ query: 'roadmap', results: [{ documentKey, name: 'Roadmap', scopeKey, folderKey, score: 0.5, source: { type: 'scope', scopeKeys: [scopeKey] } }] })).toThrow();
  });

  test('validates batch summary arithmetic and result error shape', () => {
    const schema = archiveBatchOutputSchema(archiveToolOutputSchemas['folder.find']);
    expect(schema.parse({ results: [], summary: { requested: 0, succeeded: 0, failed: 0 } })).toEqual({ results: [], summary: { requested: 0, succeeded: 0, failed: 0 } });
    expect(() => schema.parse({ results: [], summary: { total: 0, succeeded: 0, failed: 0 } })).toThrow();
    expect(() => schema.parse({ results: [], summary: { requested: 1, succeeded: 0, failed: 0 } })).toThrow();
    expect(() => schema.parse({ results: [{ key: newId(), success: false }], summary: { requested: 1, succeeded: 0, failed: 1 } })).toThrow();
    expect(schema.parse({ results: [{ key: newId(), success: false, error: { code: 'ARCHIVE_NOT_FOUND', message: 'Missing', tool: 'folder.find', retryable: false } }], summary: { requested: 1, succeeded: 0, failed: 1 } })).toMatchObject({ results: [{ error: { tool: 'folder.find' } }] });
    expect(() => schema.parse({ results: [], summary: { requested: 1, succeeded: 1, failed: 0 } })).toThrow();
  });

  test('uses the complete domain error taxonomy', () => {
    expect(ARCHIVE_ERROR_CODES).toEqual([
      'ARCHIVE_UNAUTHORIZED', 'ARCHIVE_FORBIDDEN', 'ARCHIVE_NOT_FOUND', 'ARCHIVE_CONFLICT', 'ARCHIVE_INVALID_INPUT', 'ARCHIVE_BATCH_PARTIAL_FAILURE',
      'FOLDER_CYCLE_DETECTED', 'FOLDER_NOT_EMPTY', 'FOLDER_ARCHIVED', 'FOLDER_MOVE_FORBIDDEN',
      'DOCUMENT_UNSUPPORTED_TYPE', 'DOCUMENT_INVALID_MIME_TYPE', 'DOCUMENT_TOO_LARGE', 'DOCUMENT_PROCESSING_FAILED', 'DOCUMENT_EXTRACTION_FAILED', 'DOCUMENT_EMBEDDING_FAILED', 'DOCUMENT_INSERT_FAILED', 'DOCUMENT_ARCHIVED', 'DOCUMENT_VERSION_CONFLICT', 'DOCUMENT_SHARE_INVALID', 'DOCUMENT_SPEECH_FAILED',
      'ARCHIVE_SEARCH_INVALID_SOURCE', 'ARCHIVE_SEARCH_NO_ACCESSIBLE_SOURCES', 'ARCHIVE_SEARCH_EMBEDDING_FAILED',
    ]);
  });

  test('represents exact read payloads in one batch wrapper', () => {
    const key = newId();
    expect(archiveToolOutputSchemas['document.read'].parse({ results: [{ key, success: true, data: { documentKey: key, title: 'Notes', content: 'Text' } }], summary: { requested: 1, succeeded: 1, failed: 0 } })).toMatchObject({ results: [{ data: { content: 'Text' } }] });
    expect(archiveToolOutputSchemas['document.read'].parse({ results: [{ key, success: true, data: { documentKey: key, title: 'Notes', audio: [{ index: 0, storageKey: 'audio/0.mp3', startCharacter: 0, endCharacter: 20 }], totalDurationMs: 900 } }], summary: { requested: 1, succeeded: 1, failed: 0 } })).toMatchObject({ results: [{ data: { audio: [{ index: 0 }] } }] });
    expect(() => archiveToolOutputSchemas['document.read'].parse({ results: [{ key, success: true, data: { documentKey: key, title: 'Notes', mode: 'html', content: 'wrong' } }], summary: { requested: 1, succeeded: 1, failed: 0 } })).toThrow();
  });

  test('uses batch outputs for find and grouped version listing', () => {
    for (const name of ['folder.find', 'document.find', 'document.find-version', 'document.list-versions', 'document.delete-version'] as const) {
      expect(archiveToolOutputSchemas[name].safeParse({ results: [], summary: { requested: 0, succeeded: 0, failed: 0 } }).success, name).toBe(true);
    }
  });

  test('rejects embeddings by default and sensitive share fields', () => {
    const now = '2026-07-22T00:00:00.000Z';
    const share = { key: newId(), scopeKey: newId(), documentKey: newId(), permission: 'read', createdAt: now, updatedAt: now };
    expect(archiveToolOutputSchemas['document.list-shares'].safeParse({ results: [{ key: share.documentKey, success: true, data: { documentKey: share.documentKey, shares: [share] } }], summary: { requested: 1, succeeded: 1, failed: 0 } }).success).toBe(true);
    expect(archiveToolOutputSchemas['document.list-shares'].safeParse({ results: [{ key: share.documentKey, success: true, data: { documentKey: share.documentKey, shares: [{ ...share, tokenHash: 'secret' }] } }], summary: { requested: 1, succeeded: 1, failed: 0 } }).success).toBe(false);
    expect(archiveToolOutputSchemas['folder.find'].safeParse({ results: [{ key: newId(), success: true, data: { folder: { key: newId(), scopeKey: newId(), name: 'Folder', embedding: [0.1], createdAt: now, updatedAt: now } } }], summary: { requested: 1, succeeded: 1, failed: 0 } }).success).toBe(false);
  });
});
