import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const live = process.env.DOCUMENT_E2E === 'true';
const suite = live ? describe : describe.skip;

suite('Document live E2E', () => {
  let db: any;
  let s3: any;
  let bucket: string;
  let newId: () => string;
  let runDocumentTool: any;
  let runDocumentAgentTool: any;
  let toolNames: readonly string[];
  let outputSchemas: Record<string, { parse(value: unknown): unknown }>;
  let generateDocumentExport: any;
  let documentGenerateHtml: any;
  let documentGenerateJson: any;
  let documentGenerateContent: any;
  let documentEmbed: any;
  let ListObjectsV2Command: any;
  let DeleteObjectsCommand: any;
  let GetObjectCommand: any;
  const roots = new Set<string>();
  const prefixes = new Set<string>();
  const embedding = Array.from({ length: 1024 }, (_, index) => (index % 17) / 17);
  const now = '2026-07-22T12:00:00.000Z';

  beforeAll(async () => {
    expect(process.env.ARANGO_DATABASE).toBeTruthy();
    expect(process.env.ARANGO_DATABASE).not.toBe('vorinthex');
    expect(() => new URL(process.env.AWS_ENDPOINT_URL!)).not.toThrow();
    expect(process.env.EMBEDDING_DIMENSIONS).toBe('1024');
    const [client, ids, document, processing, exports, storage, s3Module, aws] = await Promise.all([
      import('@/lib/db/client'),
      import('@/lib/ids'),
      import('.'),
      import('@/lib/ai/document-processing'),
      import('@/lib/ai/document-processing/exports'),
      import('@/lib/ai/document-processing/storage'),
      import('@/lib/s3'),
      import('@aws-sdk/client-s3'),
    ]);
    db = client.db;
    newId = ids.newId;
    runDocumentTool = document.runDocumentTool;
    runDocumentAgentTool = document.runDocumentAgentTool;
    toolNames = document.DOCUMENT_TOOL_NAMES;
    outputSchemas = document.documentToolOutputSchemas;
    documentGenerateHtml = processing.documentGenerateHtml;
    documentGenerateJson = processing.documentGenerateJson;
    documentGenerateContent = processing.documentGenerateContent;
    documentEmbed = processing.documentEmbed;
    generateDocumentExport = exports.generateDocumentExport;
    s3 = s3Module.s3;
    bucket = s3Module.S3_BUCKET;
    ListObjectsV2Command = aws.ListObjectsV2Command;
    DeleteObjectsCommand = aws.DeleteObjectsCommand;
    GetObjectCommand = aws.GetObjectCommand;
    expect(storage.documentStorage).toBeDefined();
  });

  async function removeObjects(prefix: string) {
    let token: string | undefined;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      const objects = (page.Contents ?? []).flatMap((item: any) => item.Key ? [{ Key: item.Key }] : []);
      if (objects.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
      token = page.NextContinuationToken;
    } while (token);
  }

  async function cleanupOrganization(organizationKey: string) {
    const scopeKeys = await (await db.query('FOR scope IN scopes FILTER scope.organizationKey == @organizationKey RETURN scope._key', { organizationKey })).all();
    const agentKeys = await (await db.query('FOR agent IN agents FILTER agent.scopeKey IN @scopeKeys RETURN agent._key', { scopeKeys })).all();
    const skillKeys = await (await db.query('FOR row IN agentSkills FILTER row.agentKey IN @agentKeys RETURN DISTINCT row.skillKey', { agentKeys })).all();
    const removals: Array<[string, string, Record<string, unknown>]> = [
      ['documentShares', 'row.scopeKey IN @scopeKeys', { scopeKeys }],
      ['documentVersions', 'row.scopeKey IN @scopeKeys', { scopeKeys }],
      ['documents', 'row.scopeKey IN @scopeKeys', { scopeKeys }],
      ['folders', 'row.scopeKey IN @scopeKeys', { scopeKeys }],
      ['documentIdempotency', 'row.organizationKey == @organizationKey', { organizationKey }],
      ['events', 'row.scopeId IN @scopeKeys', { scopeKeys }],
      ['agentMembers', 'row.organizationKey == @organizationKey', { organizationKey }],
      ['agentSkills', 'row.agentKey IN @agentKeys', { agentKeys }],
      ['scopeAgents', 'row.organizationKey == @organizationKey', { organizationKey }],
      ['scopeMembers', 'row.scopeKey IN @scopeKeys', { scopeKeys }],
      ['scopeScopes', 'row.parentKey IN @scopeKeys OR row.childKey IN @scopeKeys', { scopeKeys }],
      ['agents', 'row._key IN @agentKeys', { agentKeys }],
      ['skills', 'row._key IN @skillKeys', { skillKeys }],
      ['userOrganizations', 'row.organizationId == @organizationKey', { organizationKey }],
      ['users', 'row.organizationId == @organizationKey', { organizationKey }],
      ['scopes', 'row._key IN @scopeKeys', { scopeKeys }],
    ];
    for (const [collection, filter, bindVars] of removals) {
      await db.query(`FOR row IN ${collection} FILTER ${filter} REMOVE row IN ${collection}`, bindVars);
    }
    await db.query('FOR row IN organizations FILTER row._key == @organizationKey REMOVE row IN organizations', { organizationKey });
  }

  afterAll(async () => {
    for (const prefix of prefixes) await removeObjects(prefix);
    for (const organizationKey of roots) await cleanupOrganization(organizationKey);
  });

  test('executes all 35 tools through Arango transactions and LocalStack S3', async () => {
    const stale = await (await db.query('FOR organization IN organizations FILTER organization.name IN ["Document E2E", "Document outsider"] RETURN organization._key')).all();
    for (const organizationKey of stale) {
      await removeObjects(`document/${organizationKey}/`);
      await cleanupOrganization(organizationKey);
    }
    const organizationKey = newId();
    const outsiderOrganizationKey = newId();
    const scopeKey = newId();
    const secondScopeKey = newId();
    const outsiderScopeKey = newId();
    const userKey = newId();
    const membershipKey = newId();
    const agentKey = newId();
    const skillKey = newId();
    const scopeAgentKey = newId();
    const testPrefix = `document/${organizationKey}/`;
    roots.add(organizationKey);
    roots.add(outsiderOrganizationKey);
    prefixes.add(testPrefix);
    prefixes.add(`document/${outsiderOrganizationKey}/`);

    const save = (collection: string, value: Record<string, unknown>) => db.collection(collection).save(value);
    await save('organizations', { _key: organizationKey, name: 'Document E2E', is_root: false, slug: `document-${organizationKey}`, description: null, isActive: true, mfa_enabled: false, metadata: {}, createdAt: now, updatedAt: now, embedding: [] });
    await save('organizations', { _key: outsiderOrganizationKey, name: 'Document outsider', is_root: false, slug: `outside-${outsiderOrganizationKey}`, description: null, isActive: true, mfa_enabled: false, metadata: {}, createdAt: now, updatedAt: now, embedding: [] });
    for (const [key, organization, slug] of [[scopeKey, organizationKey, 'primary'], [secondScopeKey, organizationKey, 'project'], [outsiderScopeKey, outsiderOrganizationKey, 'outsider']] as const) {
      await save('scopes', { _key: key, organizationKey: organization, slug: `${slug}-${key}`, name: slug, summary: `${slug} document scope`, description: `${slug} documents`, position: 1, level: 1, deletedAt: null, embedding: [] });
    }
    await save('users', { _key: userKey, organizationId: organizationKey, email: `${userKey}@example.test`, emailHash: userKey, countryCode: 'SE', name: 'Document Owner', createdAt: now, updatedAt: now, embedding: [] });
    await save('userOrganizations', { _key: membershipKey, organizationId: organizationKey, userId: userKey, orgRole: 'owner', status: 'active', joinedAt: now, createdAt: now, updatedAt: now, embedding: [] });
    await save('scopeMembers', { _key: newId(), scopeKey, userOrganizationKey: membershipKey, role: 'owner', status: 'active' });
    await save('agents', { _key: agentKey, slug: `document-e2e-${agentKey}`, name: 'Document E2E Agent', title: 'Document E2E Agent', scopeKey, explorationRate: 0, embedding: [] });
    await save('skills', { _key: skillKey, slug: `document-e2e-${skillKey}`, name: 'Document E2E', title: 'Document E2E', definition: 'Exercise Document tools.', embedding: [] });
    await save('agentSkills', { _key: newId(), agentKey, skillKey, priority: 100 });
    await save('scopeAgents', { _key: scopeAgentKey, organizationKey, scopeKey, agentKey, position: 1, status: 'active', minimumAccessRole: 'viewer', createdByUserOrganizationKey: membershipKey, createdAt: now, updatedAt: now, embedding: [] });
    await save('agentMembers', { _key: newId(), organizationKey, scopeKey, agentKey, scopeAgentKey, userOrganizationKey: membershipKey, source: 'explicit', createdByUserOrganizationKey: membershipKey, createdAt: now, embedding: [] });

    let randomSeed = 1;
    const processingOrder: string[] = [];
    const audit = async (event: any) => {
      await save('events', { _key: newId(), scopeId: event.scopeKey, userId: event.actorKey, slug: `document.${event.tool}.${event.success ? 'succeeded' : 'failed'}`, data: { resourceKeys: event.resourceKeys, code: event.code }, embedding: [], createdAt: now });
    };
    const dependencies = {
      embed: async () => embedding,
      ingestion: {
        embeddingDimensions: 1024,
        embed: async () => embedding,
        logger: (event: any) => {
          if (event.action === 'document.processing' ? event.status === 'started' : event.status === 'completed') processingOrder.push(event.action);
        },
      },
      runAction: async (action: string, input: any) => {
        if (action === 'reason' || action === 'deep-reason') return { text: `Generated ${action}: deterministic document result.` };
        if (action === 'speak') return { audio: new TextEncoder().encode('deterministic audio'), mimeType: 'audio/mpeg', durationMs: 250 };
        if (action === 'document-generate-html') return documentGenerateHtml(input, { logger: () => undefined });
        if (action === 'document-generate-json') return documentGenerateJson(input, { logger: () => undefined });
        if (action === 'document-generate-content') return documentGenerateContent(input, { logger: () => undefined });
        if (action === 'document-embed') return documentEmbed(input, { embed: async () => embedding, dimensions: 1024, logger: () => undefined });
        throw new Error(`Unexpected provider action: ${action}`);
      },
      generateExport: (input: any) => generateDocumentExport(input, { pdfRenderer: async () => new TextEncoder().encode('%PDF-1.4\n%%EOF') }),
      random: (size: number) => Uint8Array.from({ length: size }, (_, index) => (organizationKey.charCodeAt(index % organizationKey.length) + randomSeed + index) % 255 + 1),
      clock: () => new Date(now),
      canPermanentlyDelete: () => true,
      audit,
    };
    const context = {
      organizationKey,
      runtimeScopeKey: scopeKey,
      principal: {
        kind: 'member',
        user: { key: userKey, organizationId: organizationKey },
        userOrganization: { key: membershipKey, organizationId: organizationKey, userId: userKey, orgRole: 'owner', status: 'active' },
        scopeMember: null,
      },
    };
    const covered = new Set<string>();
    const call = async (tool: string, input: unknown, options: { expectedFailures?: number } = {}) => {
      randomSeed += 37;
      const output = await runDocumentTool(tool, input, context, dependencies);
      outputSchemas[tool]!.parse(output);
      if (output && typeof output === 'object' && 'summary' in output) {
        const expectedFailures = options.expectedFailures ?? 0;
        expect((output as any).summary.failed).toBe(expectedFailures);
      }
      covered.add(tool);
      return output;
    };

    const eventRecorder = async (event: any) => save('events', { _key: newId(), ...event, embedding: [], createdAt: now });
    const agentList = await runDocumentAgentTool({ organizationKey, agentKey, tool: 'folder.list', input: { scopeKey } }, {
      authenticatedUserKey: userKey,
      events: eventRecorder,
      execute: ((tool: string, input: unknown, resolvedContext: unknown) => runDocumentTool(tool, input, resolvedContext, dependencies)) as any,
    });
    outputSchemas['folder.list']!.parse(agentList);
    covered.add('folder.list');

    const created = await call('folder.create', { folders: [{ scopeKey, name: 'Root' }, { scopeKey, name: 'Destination' }], idempotencyKey: `folders-${organizationKey}` });
    expect(created.summary).toEqual({ requested: 2, succeeded: 2, failed: 0 });
    const replay = await call('folder.create', { folders: [{ scopeKey, name: 'Root' }, { scopeKey, name: 'Destination' }], idempotencyKey: `folders-${organizationKey}` });
    expect(replay).toEqual(created);
    const rootFolderKey = created.results[0].data.folder.key;
    const destinationFolderKey = created.results[1].data.folder.key;
    const childResult = await call('folder.create', { folders: [{ scopeKey, parentFolderKey: rootFolderKey, name: 'Child' }] });
    const childFolderKey = childResult.results[0].data.folder.key;
    expect((await call('folder.find', { folderKeys: [rootFolderKey], includeChildrenCount: true, includeDocumentCount: true })).results[0].data.folder.childrenCount).toBe(1);
    expect((await call('folder.list', { scopeKey, includeDocuments: false })).folders.length).toBeGreaterThanOrEqual(2);
    const folderUpdate = await call('folder.update', { updates: [{ folderKey: rootFolderKey, description: 'Canonical root metadata' }] });
    expect(folderUpdate.results[0].data.folder.description).toBe('Canonical root metadata');
    const partial = await call('folder.rename', { renames: [{ folderKey: childFolderKey, name: 'Renamed Child' }, { folderKey: newId(), name: 'Missing' }] }, { expectedFailures: 1 });
    expect(partial.summary).toEqual({ requested: 2, succeeded: 1, failed: 1 });

    await expect(call('folder.move', { moves: [{ folderKey: childFolderKey, targetParentFolderKey: destinationFolderKey }, { folderKey: newId(), targetParentFolderKey: rootFolderKey }], atomic: true })).rejects.toMatchObject({ code: 'DOCUMENT_NOT_FOUND' });
    expect((await db.collection('folders').document(childFolderKey)).parentFolderKey).toBe(rootFolderKey);
    await call('folder.move', { moves: [{ folderKey: childFolderKey, targetParentFolderKey: destinationFolderKey }, { folderKey: rootFolderKey, targetParentFolderKey: destinationFolderKey }], atomic: true });
    expect((await db.collection('folders').document(childFolderKey)).parentFolderKey).toBe(destinationFolderKey);
    const cycle = await call('folder.move', { moves: [{ folderKey: destinationFolderKey, targetParentFolderKey: childFolderKey }] }, { expectedFailures: 1 });
    expect(cycle.results[0].error.code).toBe('FOLDER_CYCLE_DETECTED');
    await call('folder.move', { moves: [{ folderKey: childFolderKey, targetParentFolderKey: rootFolderKey }, { folderKey: rootFolderKey }] });

    const text = '# Document Roadmap\n\nDeterministic source body.\n\n```ts\nsecretCode()\n```\n\nFinal paragraph.';
    const processed = await call('document.processing', {
      file: { filename: 'roadmap.md', mimeType: 'text/markdown', sizeBytes: new TextEncoder().encode(text).byteLength, bytes: new TextEncoder().encode(text) },
      scopeKey, folderKey: childFolderKey, idempotencyKey: `processing-${organizationKey}`,
    });
    const documentKey = processed.document.key;
    expect(processingOrder).toEqual(['document.processing', 'document-validate', 'storage-upload', 'document-extract', 'document-generate-html', 'document-generate-json', 'document-generate-content', 'document-embed', 'document-insert']);
    expect((await call('document.find', { documentKeys: [documentKey], include: ['html', 'json', 'content', 'embedding', 'folder', 'shares'] })).results[0].data.document.embedding).toHaveLength(1024);
    expect((await call('document.list', { folderKey: childFolderKey, extensions: ['md'] })).documents.map((item: any) => item.key)).toContain(documentKey);
    for (const mode of ['content', 'html', 'json'] as const) expect((await call('document.read', { documentKeys: [documentKey], mode })).summary.failed).toBe(0);
    const ephemeralAudio = await call('document.read', { documentKeys: [documentKey], mode: 'audio', startOffset: 2, includeTitle: true, includeCode: false });
    expect(ephemeralAudio.results[0].data.audio[0].url).toStartWith('data:audio/mpeg;base64,');
    const persistedAudio = await call('document.read', { documentKeys: [documentKey], mode: 'audio', persistAudio: true, idempotencyKey: `audio-${organizationKey}` });
    const speechKey = persistedAudio.results[0].data.audio[0].storageKey;
    expect(await s3.send(new GetObjectCommand({ Bucket: bucket, Key: speechKey }))).toBeDefined();

    await call('document.update', { updates: [{ documentKey, content: 'Canonical updated body with semantic roadmap.', createVersion: true }] });
    const canonical = (await call('document.find', { documentKeys: [documentKey], include: ['html', 'json', 'content', 'embedding'] })).results[0].data.document;
    expect(canonical.content).toContain('Canonical updated body');
    expect(canonical.html).toContain('Canonical updated body');
    expect(canonical.embedding).toHaveLength(1024);
    await call('document.rename', { renames: [{ documentKey, name: 'Renamed Roadmap' }] });
    const beforeMoveEmbedding = (await db.collection('documents').document(documentKey)).embedding;
    await call('document.move', { moves: [{ documentKey, targetFolderKey: rootFolderKey }] });
    expect((await db.collection('documents').document(documentKey)).embedding).toEqual(beforeMoveEmbedding);

    const share = await call('document.share', { shares: [{ documentKey, permission: 'comment', password: 'correct horse battery staple', expiresAt: '2027-07-22T12:00:00.000Z' }] });
    const shareKey = share.results[0].data.share.key;
    const shareToken = share.results[0].data.token;
    const rawShare = await db.collection('documentShares').document(shareKey);
    expect(JSON.stringify(rawShare)).not.toContain(shareToken);
    expect(rawShare.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rawShare.passwordHash).toStartWith('scrypt:');
    const listedShares = await call('document.list-shares', { documentKeys: [documentKey] });
    expect(JSON.stringify(listedShares)).not.toContain('tokenHash');

    const versionOne = (await call('document.create-version', { documentKeys: [documentKey], labels: { [documentKey]: 'Release one' } })).results[0].data.version;
    const versionTwo = (await call('document.create-version', { documentKeys: [documentKey], labels: { [documentKey]: 'Release two' }, atomic: true })).results[0].data.version;
    expect(versionTwo.version).toBeGreaterThan(versionOne.version);
    expect((await call('document.find-version', { versionKeys: [versionOne.key], include: ['html', 'json', 'content', 'embedding'] })).results[0].data.version.embedding).toHaveLength(1024);
    expect((await call('document.list-versions', { documentKeys: [documentKey], limit: 1 })).results[0].data.versions).toHaveLength(1);
    const restoredVersion = await call('document.restore-version', { restores: [{ documentKey, versionKey: versionOne.key, createBackupVersion: true }], atomic: true });
    expect(restoredVersion.results[0].data.document.key).toBe(documentKey);

    const copied = await call('document.copy', { copies: [{ documentKey, targetFolderKey: destinationFolderKey, newName: 'Complete Copy', includeVersions: true, includeShares: true }] });
    const copiedDocumentKey = copied.results[0].data.document.key;
    expect(copied.results[0].data.shares).toHaveLength(1);
    const copiedVersions = await call('document.list-versions', { documentKeys: [copiedDocumentKey] });
    expect(copiedVersions.results[0].data.versions.length).toBeGreaterThanOrEqual(3);

    for (const format of ['original', 'html', 'txt', 'md'] as const) {
      const download = await call('document.download', { documentKeys: [documentKey], format });
      expect(Buffer.from(download.results[0].data.content, 'base64').byteLength).toBeGreaterThan(0);
    }
    const exports = await call('document.export', { exports: ['html', 'txt', 'md', 'pdf', 'docx'].map((format) => ({ documentKey, format })), atomic: true });
    expect(exports.summary).toEqual({ requested: 5, succeeded: 5, failed: 0 });
    expect(Buffer.from(exports.results[4].data.content, 'base64').subarray(0, 2).toString()).toBe('PK');

    expect((await call('document.summarize', { documentKeys: [documentKey, copiedDocumentKey], combine: true })).results[0].data.text).toContain('deterministic');
    await call('document.summarize', { documentKeys: [documentKey], persist: true, idempotencyKey: `summary-${organizationKey}` });
    const translationPreview = await call('document.translate', { documentKeys: [documentKey], targetLanguage: 'French', mode: 'preview' });
    expect(translationPreview.results[0].data.text).toContain('deterministic');
    const translationCopy = await call('document.translate', { documentKeys: [documentKey], targetLanguage: 'French', mode: 'copy', idempotencyKey: `translate-copy-${organizationKey}` });
    expect(translationCopy.results[0].data.persistedDocumentKey).toBeString();
    const translationReplace = await call('document.translate', { documentKeys: [documentKey], targetLanguage: 'French', mode: 'replace', idempotencyKey: `translate-replace-${organizationKey}` });
    expect(translationReplace.results[0].data.persistedDocumentKey).toBe(documentKey);
    const rewrite = await call('document.rewrite', { rewrites: [{ documentKey, instruction: 'Improve clarity', mode: 'preview' }, { documentKey: copiedDocumentKey, instruction: 'Shorten', mode: 'copy' }] });
    expect(rewrite.results[0].data.text).toContain('deterministic');
    expect(rewrite.results[1].data.persistedDocumentKey).toBeString();
    const rewriteReplace = await call('document.rewrite', { rewrites: [{ documentKey, instruction: 'Replace clearly', mode: 'replace' }], idempotencyKey: `rewrite-${organizationKey}` });
    expect(rewriteReplace.results[0].data.persistedDocumentKey).toBe(documentKey);

    const secondFolders = await call('folder.create', { folders: [{ scopeKey: secondScopeKey, name: 'Project Documents' }] });
    const secondFolderKey = secondFolders.results[0].data.folder.key;
    const secondText = 'Semantic roadmap from the project scope.';
    const secondDocument = await call('document.processing', { file: { filename: 'project.txt', mimeType: 'text/plain', sizeBytes: secondText.length, bytes: new TextEncoder().encode(secondText) }, scopeKey: secondScopeKey, folderKey: secondFolderKey });
    const outsiderFolderKey = newId();
    const outsiderDocumentKey = newId();
    await save('folders', { _key: outsiderFolderKey, scopeKey: outsiderScopeKey, name: 'Private outsider', embedding, createdAt: now, updatedAt: now });
    await save('documents', { _key: outsiderDocumentKey, scopeKey: outsiderScopeKey, folderKey: outsiderFolderKey, name: 'Forbidden source', extension: 'txt', mimeType: 'text/plain', storageKey: `document/${outsiderOrganizationKey}/${outsiderScopeKey}/${outsiderDocumentKey}/original.txt`, sizeBytes: 8, html: '<p>roadmap</p>', json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'roadmap' }] }] }, content: 'roadmap', embedding, createdAt: now, updatedAt: now });
    const scopedSearch = await call('scope.document.search', { scopeKey, query: 'roadmap', sources: [{ type: 'scope', scopeKeys: [scopeKey] }, { type: 'project', projectKeys: [secondScopeKey] }, { type: 'folder', folderKeys: [rootFolderKey], includeDescendants: true }], include: ['snippet', 'content', 'html', 'folder', 'scoreBreakdown'] });
    expect(scopedSearch.results.some((item: any) => item.documentKey === documentKey)).toBe(true);
    const organizationSearch = await call('organization.document.search', { organizationKey, query: 'roadmap', sources: [{ type: 'scope', scopeKeys: [scopeKey, secondScopeKey, outsiderScopeKey] }], include: ['snippet', 'scope', 'scoreBreakdown'] });
    expect(organizationSearch.results.map((item: any) => item.documentKey)).toContain(secondDocument.document.key);
    expect(organizationSearch.results.map((item: any) => item.documentKey)).not.toContain(outsiderDocumentKey);

    const unshared = await call('document.unshare', { shareKeys: [shareKey], atomic: true });
    expect(unshared.results[0].data.share.revokedAt).toBe(now);
    expect((await call('document.list-shares', { documentKeys: [documentKey], includeRevoked: true })).results[0].data.shares[0].revokedAt).toBe(now);
    const archivedDocument = await call('document.archive', { documentKeys: [documentKey], atomic: true });
    expect(archivedDocument.results[0].data.document.deletedAt).toBe(now);
    await call('document.delete-version', { versionKeys: [versionTwo.key], atomic: true });
    expect(await (await db.query('RETURN DOCUMENT(documentVersions, @key) == null', { key: versionTwo.key })).next()).toBe(true);
    const restoredDocument = await call('document.restore', { documentKeys: [documentKey], atomic: true });
    expect(restoredDocument.results[0].data.document.deletedAt).toBeNull();

    await call('folder.archive', { folderKeys: [rootFolderKey], includeDescendants: true, atomic: true });
    expect((await db.collection('documents').document(documentKey)).deletedAt).toBe(now);
    await call('folder.restore', { folderKeys: [rootFolderKey], includeDescendants: true, atomic: true });
    expect((await db.collection('documents').document(documentKey)).deletedAt).toBeNull();

    await call('document.archive', { documentKeys: [copiedDocumentKey] });
    const copiedRaw = await db.collection('documents').document(copiedDocumentKey);
    const copiedStorageKey = copiedRaw.storageKey;
    expect((await call('document.delete', { documentKeys: [copiedDocumentKey], deleteVersions: true, deleteShares: true })).summary.failed).toBe(0);
    expect(await (await db.query('RETURN DOCUMENT(documents, @key) == null', { key: copiedDocumentKey })).next()).toBe(true);
    await expect(s3.send(new GetObjectCommand({ Bucket: bucket, Key: copiedStorageKey }))).rejects.toBeDefined();

    const disposable = await call('folder.create', { folders: [{ scopeKey, name: 'Disposable' }] });
    const disposableKey = disposable.results[0].data.folder.key;
    await call('folder.archive', { folderKeys: [disposableKey] });
    await call('folder.delete', { folderKeys: [disposableKey], atomic: true });
    expect(await (await db.query('RETURN DOCUMENT(folders, @key) == null', { key: disposableKey })).next()).toBe(true);

    expect([...covered].sort()).toEqual([...toolNames].sort());
    const ledger = await db.query(`FOR row IN documentIdempotency FILTER row.organizationKey == @organizationKey RETURN row`, { organizationKey });
    const claims = await ledger.all();
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((claim: any) => claim.status === 'completed' && typeof claim.responseCiphertext === 'string' && !('response' in claim))).toBe(true);
    const auditCursor = await db.query(`FOR event IN events FILTER event.scopeId == @scopeKey && STARTS_WITH(event.slug, "document.") RETURN event`, { scopeKey });
    expect((await auditCursor.all()).length).toBeGreaterThanOrEqual(toolNames.length);

    await removeObjects(testPrefix);
    const remaining = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: testPrefix }));
    expect(remaining.KeyCount ?? 0).toBe(0);
  }, 180_000);

  test('migrates plaintext shares and legacy versions in a fresh database', async () => {
    const { Database } = await import('arangojs');
    const { migrateArchiveShares: migrateDocumentShares, migrateArchiveVersions: migrateDocumentVersions } = await import('@/db/arango-migrate');
    const temporaryName = `document_e2e_${newId().replaceAll('-', '')}`;
    const root = new Database({ url: process.env.ARANGO_URL!, auth: { username: process.env.ARANGO_USERNAME!, password: process.env.ARANGO_ROOT_PASSWORD! } });
    await root.createDatabase(temporaryName);
    const temporary = root.database(temporaryName);
    try {
      await temporary.createCollection('documentShares');
      await temporary.createCollection('documentVersions');
      await temporary.collection('documentShares').ensureIndex({ type: 'persistent', fields: ['token'], unique: true });
      const shareKeys = Array.from({ length: 105 }, () => newId());
      await temporary.collection('documentShares').import(shareKeys.map((key, index) => ({ _key: key, token: `legacy-token-${index}`, permission: index % 2 ? 'read' : 'edit' })));
      const versionKeys = Array.from({ length: 55 }, () => newId());
      const legacyDocumentKey = newId();
      await temporary.collection('documentVersions').import(versionKeys.map((key, index) => ({ _key: key, documentKey: legacyDocumentKey, version: index + 1, content: `Historical paragraph ${index}\n\nSecond block`, embedding })));

      await migrateDocumentShares(temporary);
      await migrateDocumentVersions(temporary);
      await migrateDocumentShares(temporary);
      await migrateDocumentVersions(temporary);
      await temporary.collection('documentShares').ensureIndex({ type: 'persistent', fields: ['tokenHash'], unique: true });
      await temporary.collection('documentVersions').ensureIndex({ type: 'persistent', fields: ['documentKey', 'version'], unique: true });

      const shares = await (await temporary.query('FOR share IN documentShares SORT share._key RETURN share')).all();
      expect(shares).toHaveLength(105);
      expect(shares.every((share: any) => !('token' in share) && /^[a-f0-9]{64}$/.test(share.tokenHash))).toBe(true);
      expect(new Set(shares.map((share: any) => share.tokenHash)).size).toBe(105);
      expect(shares[0].permission).toBe('comment');
      const versions = await (await temporary.query('FOR version IN documentVersions SORT version._key RETURN version')).all();
      expect(versions).toHaveLength(55);
      expect(versions.every((version: any) => version.html.includes('<p>') && version.json.type === 'doc' && version.embedding.length === 1024)).toBe(true);
      const shareIndexes = await temporary.collection('documentShares').indexes();
      const versionIndexes = await temporary.collection('documentVersions').indexes();
      expect(shareIndexes.some((index: any) => index.unique && index.fields?.join(',') === 'tokenHash')).toBe(true);
      expect(shareIndexes.some((index: any) => index.fields?.join(',') === 'token')).toBe(false);
      expect(versionIndexes.some((index: any) => index.unique && index.fields?.join(',') === 'documentKey,version')).toBe(true);
    } finally {
      temporary.close();
      await root.dropDatabase(temporaryName);
      root.close();
    }
  }, 60_000);
});
