#!/usr/bin/env bun
/** Isolated, paid-provider Core conversation. No production database or real account is touched. */
import { createHash, randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Database } from 'arangojs';
import sharp from 'sharp';
import { loadEnvironment } from './lib/environment';
import { LIVE_SCENARIOS } from './core-query-live-scenarios';

if (process.env.CORE_QUERY_LIVE !== 'true') throw new Error('Set CORE_QUERY_LIVE=true to run paid Core conversations.');
loadEnvironment('dev');
const url = new URL(process.env.ARANGO_URL ?? '');
if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('This fixture requires a local ArangoDB endpoint.');
const storageUrl = new URL(process.env.S3_ENDPOINT_URL ?? process.env.AWS_ENDPOINT_URL ?? '');
if (!['localhost', '127.0.0.1', '::1'].includes(storageUrl.hostname)) throw new Error('This fixture requires a local S3 endpoint.');
if (!process.env.OPENROUTER_API_KEY?.trim()) throw new Error('The dev OpenRouter key is unavailable.');
const databaseName = `core_query_live_${randomUUID().replaceAll('-', '')}`;
process.env.ARANGO_DATABASE = databaseName;
const selectionArg = process.argv.find((value) => value.startsWith('--turns='));
const selectedTurns = selectionArg ? selectionArg.slice('--turns='.length).split(',').map(Number) : LIVE_SCENARIOS.map((_, index) => index + 1);
if (!selectedTurns.length || new Set(selectedTurns).size !== selectedTurns.length || selectedTurns.some((value) => !Number.isInteger(value) || value < 1 || value > LIVE_SCENARIOS.length)) throw new Error('Use distinct 1-based scenario numbers with --turns=1,2,...,50.');
const transcriptPath = new URL(selectionArg ? './core-query-live-recheck.txt' : './core-query-live-transcript.txt', import.meta.url);
const system = new Database({ url: url.toString(), auth: { username: process.env.ARANGO_USERNAME ?? 'root', password: process.env.ARANGO_ROOT_PASSWORD ?? '' } });
let created = false;
let removeStoredObjects: (() => Promise<void>) | undefined;
const lines = [
  '# Real Core conversation against an isolated dummy database',
  '',
  'Provider: live configured Core model. Data: synthetic and stored in a temporary local ArangoDB database.',
  'Question and answer text below is the actual provider output, not scripted.',
  '',
];

try {
  await system.createDatabase(databaseName);
  created = true;
  // Initialize the canonical search module before concurrent imports that also
  // register assistant capabilities; Bun otherwise evaluates their existing cycle
  // in the opposite order when imported together from a standalone script.
  await import('../src/lib/app-search/service');
  const { runTool } = await import('../src/lib/ai/tools');
  const { createConversationService } = await import('../src/lib/conversations/service');
  const { collections } = await import('../src/db/arango-migrate');
  const { db } = await import('../src/lib/db/client');
  const { WORKSPACE_SEARCH_FIELDS, ensureWorkspaceSearchView } = await import('../src/lib/app-search/graph-view');
  const { findWorkspaceGraph } = await import('../src/lib/app-search/graph-query');
  const { requiresFreshWorkspaceRead } = await import('../src/lib/ai/agents/fresh-read');
  const { toArangoDoc } = await import('../src/lib/db/base');
  const { newId } = await import('../src/lib/ids');
  const { embedText } = await import('../src/lib/embeddings');
  const { userSchema } = await import('../src/lib/db/users.node');
  const { teamSchema } = await import('../src/lib/db/teams.node');
  const { userTeamSchema } = await import('../src/lib/db/user-team.node');
  const { scopeSchema } = await import('../src/lib/ai/scopes/schema');
  const { folderSchema } = await import('../src/lib/db/folders.node');
  const { documentSchema } = await import('../src/lib/db/documents.node');
  const { collectionSchema } = await import('../src/lib/db/collections.node');
  const { imageSchema } = await import('../src/lib/db/images.node');
  const { collectionImageSchema } = await import('../src/lib/db/collection-images.node');
  const { imageCollectionMemorySchema } = await import('../src/lib/db/image-collection-memories.node');
  const { bookSchema } = await import('../src/lib/db/books.node');
  const { bookChapterSchema } = await import('../src/lib/db/book-chapters.node');
  const { imageCollectionHighlightSchema } = await import('../src/lib/db/image-collection-highlights.node');
  const { placeSchema } = await import('../src/lib/db/places.node');
  const { tripSchema } = await import('../src/lib/db/trips.node');
  const { tripPlaceSchema } = await import('../src/lib/db/trip-places.node');
  const { tripAttachmentSchema } = await import('../src/lib/db/trip-attachments.node');
  const { tripGuideSchema } = await import('../src/lib/db/trip-guides.node');
  const { placeReferenceSchema } = await import('../src/lib/db/place-references.node');
  const { userConnectorSchema } = await import('../src/lib/email-inbox/connector-schema');
  const { emailInboxSchema } = await import('../src/lib/db/email-inboxes.node');
  const { emailThreadRecordSchema, emailMessageRecordSchema, emailDraftRecordSchema, emailToneRecordSchema } = await import('../src/lib/db/email-records.node');
  const { tagSchema } = await import('../src/lib/db/tags.node');
  const { tagAssignmentSchema } = await import('../src/lib/db/tag-assignments.node');
  const { s3, S3_BUCKET } = await import('../src/lib/s3');
  const extra = ['scopeMembers', 'scopeScopes', 'userConnectors', 'userInboxThreads', 'userInboxMessages', 'conversationAttachmentArtifacts'];
  for (const name of [...new Set([...collections.map(({ name }) => name), ...Object.keys(WORKSPACE_SEARCH_FIELDS), ...extra])]) {
    if (!await db.collection(name).exists()) await db.createCollection(name);
  }
  await ensureWorkspaceSearchView(db);
  const now = new Date().toISOString();
  const teamKey = newId(), scopeKey = newId(), userKey = newId(), memberKey = newId();
  const folderKey = newId(), documentKey = newId(), collectionKey = newId(), firstImageKey = newId(), secondImageKey = newId(), bookKey = newId();
  const researchFolderKey = newId(), ledgerKey = newId(), surveyKey = newId(), cityCollectionKey = newId(), signImageKey = newId(), historyBookKey = newId(), memoryKey = newId();
  const stockholmKey = newId(), osloKey = newId(), tripKey = newId(), connectorKey = newId(), inboxKey = newId();
  let railThreadKey = '';
  const team = teamSchema.parse({ key: teamKey, name: 'Fixture Team', createdAt: now, updatedAt: now });
  const user = userSchema.parse({ key: userKey, currentScopeKey: scopeKey, email: 'core-query-fixture@example.test', emailHash: createHash('sha256').update('core-query-fixture@example.test').digest('hex'), name: 'Fixture User', microSparkBalance: 1_000_000_000, createdAt: now, updatedAt: now });
  const membership = userTeamSchema.parse({ key: memberKey, teamKey, userId: userKey, teamRole: 'owner', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const scope = scopeSchema.parse({ key: scopeKey, teamKey, slug: 'fixture-workspace', name: 'Fixture Workspace', summary: 'A disposable test workspace.', description: null, position: 1, visibility: 'private' });
  const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member' as const, user, userTeam: membership, scopeMember: null } };
  for (const [name, value] of [['teams', team], ['users', user], ['userTeams', membership], ['scopes', scope]] as const) await db.collection(name).save(toArangoDoc(value));

  const [folderEmbedding, documentEmbedding, collectionEmbedding, boatEmbedding, kiteEmbedding, bookEmbedding] = await Promise.all([
    'Travel Notes', 'Train Notes. Train departs Stockholm Friday at 09:15.', 'Aurora Album', 'A blue boat beside a quiet lake.', 'A red kite over a grassy meadow.', 'Quiet Astronomy: A calm introduction to the night sky.',
  ].map((text) => embedText({ text, purpose: 'document' })));
  const embeddings = new Map<string, number[]>();
  for (const [name, text] of Object.entries({
    ledger: 'Harbor Ledger. A blue boat is moored at Pier Seven in Stockholm.',
    survey: 'Sky Survey. Orion is visible above Stockholm after sunset.',
    city: 'City Nights. Stockholm harbor photos and a blue boat.',
    sign: 'A wooden Stockholm sign reading KUST 42 at night.',
    history: 'Harbor History. Boats and trade at Pier Seven in Stockholm.',
    moon: 'Moonlight Basics. Moon phases and Orion in the night sky.',
    pier: 'Pier Seven Stories. A blue boat and historic harbor trade.',
    stockholm: 'Stockholm. A visited city in Sweden with a busy harbor.',
    oslo: 'Oslo. A wishlist city in Norway.',
    trip: 'Nordic Rail. Travel by train from Stockholm to Oslo.',
    guide: 'Nordic Rail guide. Train departs Stockholm Friday at 09:15, then travels to Oslo.',
    restaurant: 'Stockholm restaurants. North Market offers lingonberry tart.',
    inbox: 'Work Mail. Rail booking and photo sharing correspondence.',
    railMail: 'Rail booking confirmation. Stockholm departure Friday at 09:15.',
    photoMail: 'Gallery share. A blue boat at Pier Seven in Stockholm.',
    tag: 'travel. Saved trip, folder, and image collection.',
  })) embeddings.set(name, await embedText({ text, purpose: 'document' }));
  const vector = (name: string) => embeddings.get(name)!;
  const save = async (name: string, value: { key: string }) => db.collection(name).save(toArangoDoc(value));
  const folder = folderSchema.parse({ key: folderKey, scopeKey, name: 'Travel Notes', embedding: folderEmbedding, createdAt: now, updatedAt: now });
  const document = documentSchema.parse({ key: documentKey, scopeKey, folderKey, name: 'Train Notes', content: 'Train departs Stockholm Friday at 09:15.', embedding: documentEmbedding, createdAt: now, updatedAt: now });
  const collection = collectionSchema.parse({ key: collectionKey, scopeKey, ownerKey: memberKey, name: 'Aurora Album', embedding: collectionEmbedding, createdAt: now, updatedAt: now });
  const signStorageKey = `core-query-live/${randomUUID()}/city-sign.png`;
  const signPng = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360"><rect width="720" height="360" fill="#182338"/><rect x="90" y="90" width="540" height="180" rx="14" fill="#f5e8cf"/><text x="360" y="208" fill="#14243c" text-anchor="middle" font-family="Arial" font-size="76" font-weight="bold">KUST 42</text></svg>')).png().toBuffer();
  await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: signStorageKey, Body: signPng, ContentType: 'image/png' }));
  removeStoredObjects = async () => { await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: signStorageKey })); };
  const images = [
    imageSchema.parse({ key: firstImageKey, scopeKey, filename: 'blue-boat.png', caption: 'A blue boat beside a quiet lake.', storageKey: 'fixture/blue-boat.png', mimeType: 'image/png', sizeBytes: 1_048_576, width: 256, height: 256, embedding: boatEmbedding, createdByKey: memberKey, origin: 'uploaded', createdAt: now, updatedAt: now }),
    imageSchema.parse({ key: secondImageKey, scopeKey, filename: 'red-kite.png', caption: 'A red kite over a grassy meadow.', storageKey: 'fixture/red-kite.png', mimeType: 'image/png', sizeBytes: 2_097_152, width: 256, height: 256, embedding: kiteEmbedding, createdByKey: memberKey, origin: 'uploaded', createdAt: now, updatedAt: now }),
    imageSchema.parse({ key: signImageKey, scopeKey, filename: 'city-sign.png', caption: 'A wooden sign in Stockholm at night reading KUST 42.', storageKey: signStorageKey, mimeType: 'image/png', sizeBytes: signPng.byteLength, width: 720, height: 360, embedding: vector('sign'), createdByKey: memberKey, origin: 'uploaded', createdAt: now, updatedAt: now }),
  ];
  const book = bookSchema.parse({ key: bookKey, scopeKey, title: 'Quiet Astronomy', description: 'A calm introduction to the night sky.', goal: 'Learn the stars', audience: 'Beginners', outcome: 'Recognize familiar constellations', language: 'English', status: 'ready', chapterCount: 0, estimatedMinutes: 30, embedding: bookEmbedding, createdAt: now, updatedAt: now });
  const historyBook = bookSchema.parse({ key: historyBookKey, scopeKey, title: 'Harbor History', description: 'Boats and trade at Pier Seven in Stockholm.', goal: 'Explore port history', audience: 'Travelers', outcome: 'Understand harbor trade', language: 'English', status: 'ready', chapterCount: 1, estimatedMinutes: 45, embedding: vector('history'), createdAt: now, updatedAt: now });
  await save('folders', folder);
  await save('folders', folderSchema.parse({ key: researchFolderKey, scopeKey, name: 'Research Folder', embedding: vector('survey'), createdAt: now, updatedAt: now }));
  await save('documents', document);
  await save('documents', documentSchema.parse({ key: ledgerKey, scopeKey, folderKey, name: 'Harbor Ledger', content: 'A blue boat is moored at Pier Seven in Stockholm. Historic harbor trade connects this note to Harbor History.', embedding: vector('ledger'), createdAt: now, updatedAt: now }));
  await save('documents', documentSchema.parse({ key: surveyKey, scopeKey, folderKey: researchFolderKey, name: 'Sky Survey', content: 'Orion rises above Stockholm after sunset. Quiet Astronomy explains the same constellation.', embedding: vector('survey'), createdAt: now, updatedAt: now }));
  await save('collections', collection);
  await save('collections', collectionSchema.parse({ key: cityCollectionKey, scopeKey, ownerKey: memberKey, name: 'City Nights', description: 'Stockholm harbor, boat and sign.', embedding: vector('city'), createdAt: now, updatedAt: now }));
  await save('books', bookSchema.parse({ ...book, chapterCount: 1 }));
  await save('books', historyBook);
  for (const [index, chapter] of [
    { bookKey, title: 'Moonlight Basics', content: 'Moon phases change how the Moon looks; Orion is a constellation visible in the winter night sky.', embedding: vector('moon') },
    { bookKey: historyBookKey, title: 'Pier Seven Stories', content: 'A blue boat at Pier Seven carried stories of historic harbor trade in Stockholm.', embedding: vector('pier') },
  ].entries()) await save('bookChapters', bookChapterSchema.parse({ key: newId(), scopeKey, ...chapter, description: chapter.content, objective: 'Learn the chapter topic', evidenceKeyPoints: ['The chapter explains its topic'], priorTransition: 'Start', nextTransition: 'Continue', repetitionBoundaries: ['Avoid repeating the introduction'], targetWordMin: 150, targetWordMax: 165, status: 'finalized', position: 1, estimatedMinutes: index === 0 ? 30 : 45, createdAt: now, updatedAt: now }));
  for (const image of images) {
    await save('images', image);
    await save('collectionImages', collectionImageSchema.parse({ key: newId(), scopeKey, collectionKey: image.key === signImageKey ? cityCollectionKey : collectionKey, imageKey: image.key, addedByKey: memberKey, createdAt: now }));
  }
  await save('collectionImages', collectionImageSchema.parse({ key: newId(), scopeKey, collectionKey: cityCollectionKey, imageKey: firstImageKey, addedByKey: memberKey, createdAt: now }));
  await save('imageCollectionMemories', imageCollectionMemorySchema.parse({ key: memoryKey, scopeKey, imageKey: firstImageKey, text: 'We watched a blue boat drift past the lakeside at sunset.', createdByKey: memberKey, createdAt: now, updatedAt: now }));
  await save('imageCollecitionHightlights', imageCollectionHighlightSchema.parse({ key: newId(), scopeKey, collectionKey, imageKeys: [firstImageKey, secondImageKey], createdByKey: memberKey, createdAt: now, updatedAt: now }));

  for (const place of [
    placeSchema.parse({ key: stockholmKey, userKey, scopeKey, saved: true, kind: 'place', name: 'Stockholm', status: 'visited', summary: 'Swedish capital with an active harbor and North Market.', countryCode: 'SE', latitude: 59.3293, longitude: 18.0686, embedding: vector('stockholm'), createdAt: now }),
    placeSchema.parse({ key: osloKey, userKey, scopeKey, saved: true, kind: 'place', name: 'Oslo', status: 'wishlist', summary: 'Norwegian capital and the next stop on Nordic Rail.', countryCode: 'NO', latitude: 59.9139, longitude: 10.7522, embedding: vector('oslo'), createdAt: now }),
  ]) await save('places', place);
  await save('trips', tripSchema.parse({ key: tripKey, userKey, scopeKey, name: 'Nordic Rail', description: 'Travel by train from Stockholm to Oslo, departing Friday at 09:15.', status: 'planned', embedding: vector('trip'), embeddingContentVersion: 1, createdAt: now, updatedAt: now }));
  for (const [position, placeKey] of [stockholmKey, osloKey].entries()) await save('tripPlaces', tripPlaceSchema.parse({ key: newId(), scopeKey, tripKey, placeKey, position, createdAt: now }));
  for (const [position, targetType, targetKey] of [[0, 'folder', folderKey], [1, 'collection', cityCollectionKey]] as const) await save('tripAttachments', tripAttachmentSchema.parse({ key: newId(), scopeKey, tripKey, targetType, targetKey, position, createdAt: now }));
  const guideContent = [
    '## Route\nNordic Rail begins in Stockholm and continues to Oslo. The saved Train Notes say the train departs Stockholm on Friday at 09:15. Keep the Travel Notes folder nearby when reviewing the journey. The trip links that folder and the City Nights photo collection, so the written plan and saved photographs describe the same journey. Check the booking message in Work Mail before leaving.',
    '## Stockholm\nSpend time around the old harbor and take in the waterfront before departure. The City Nights collection includes a blue boat and a sign photographed after dark. Harbor Ledger places a blue boat at Pier Seven in Stockholm. Those records can help connect the waterfront photographs to the written account without claiming that every photograph depicts the exact place named in the note.',
    '## Oslo and planning\nOslo is the second saved city on this trip and remains on the wishlist. Leave room in the itinerary for a calm arrival and independent exploration. The saved itinerary is an account of the user’s plans, not a live timetable. Verify current travel conditions separately if necessary, and use the folder, inbox, and collection as private references when comparing the journey with other workspace material.',
  ].join('\n\n');
  await save('tripGuides', tripGuideSchema.parse({ key: newId(), scopeKey, userKey, tripKey, name: 'Nordic Rail guide', content: guideContent, embedding: vector('guide'), contentChunks: [guideContent], chunkEmbeddings: [vector('guide')], semanticChunkCount: 1, semanticContentHash: createHash('sha256').update(guideContent).digest('hex'), idempotencyKey: 'fixture-guide', requestHash: createHash('sha256').update('fixture-guide').digest('hex'), createdAt: now, updatedAt: now }));
  const restaurantContent = [
    '## A market stop\nThe saved Stockholm dining reference recommends North Market for lingonberry tart. It places the stop near the old harbor, making it a natural addition to a leisurely waterfront walk. The recommendation is a persisted idea in this personal travel workspace, rather than a claim about current opening hours or table availability. Keep that distinction in mind when using it to plan the day.',
    '## Neighborhood context\nStockholm has several waterfront areas with different atmospheres. This reference focuses on a quiet market visit as a complement to the busier harbor sights. You can compare it with your photographs from City Nights and the written Harbor Ledger note to decide whether the market fits your interests. The blue boat story is separate from the food recommendation, although both are part of the saved city context.',
    '## Planning note\nIf you include North Market in the Nordic Rail journey, leave enough time before the Friday 09:15 train departure recorded in Train Notes. This note does not verify a real venue, a current menu, or travel times. Treat it as a saved recommendation to review alongside the itinerary and booking correspondence. The useful connection is that all three records belong to the same Stockholm planning context.',
  ].join('\n\n');
  await save('placeReferences', placeReferenceSchema.parse({ key: newId(), scopeKey, userKey, placeKey: stockholmKey, kind: 'restaurants', name: 'Stockholm dining', content: restaurantContent, embedding: vector('restaurant'), contentChunks: [restaurantContent], chunkEmbeddings: [vector('restaurant')], semanticChunkCount: 1, semanticContentHash: createHash('sha256').update(restaurantContent).digest('hex'), idempotencyKey: 'fixture-restaurant', requestHash: createHash('sha256').update('fixture-restaurant').digest('hex'), createdAt: now, updatedAt: now }));

  const fixtureEmail = 'fixture@example.test';
  await save('userConnectors', userConnectorSchema.parse({ key: connectorKey, userKey, teamKey, scopeKey, provider: 'gmail', providerAccountId: fixtureEmail, email: fixtureEmail, encryptedCredentials: 'isolated-fixture-no-provider-access', encryptionKeyId: 'fixture', accessTokenFingerprint: 'f'.repeat(64), scopes: ['https://www.googleapis.com/auth/gmail.readonly'], status: 'active', syncEnabled: false, initialSyncCompleted: true, createdAt: now, updatedAt: now }));
  await save('emailInboxes', emailInboxSchema.parse({ key: inboxKey, userKey, teamKey, scopeKey, connectorKey, name: 'Work Mail', description: 'Rail booking and Gallery sharing messages.', embedding: vector('inbox'), isFavorite: false, createdAt: now, updatedAt: now }));
  for (const [index, thread] of [
    { subject: 'Rail booking confirmation', summary: 'The train departs Stockholm on Friday at 09:15.', body: 'Your Nordic Rail booking is confirmed: depart Stockholm Friday at 09:15, arrive Oslo later that day.', sender: 'rail@example.test', embedding: vector('railMail') },
    { subject: 'Gallery share', summary: 'A blue boat photographed by Pier Seven in Stockholm.', body: 'I shared a blue boat photo from Pier Seven in Stockholm. It is also in City Nights.', sender: 'photos@example.test', embedding: vector('photoMail') },
  ].entries()) {
    const threadKey = newId();
    if (index === 0) railThreadKey = threadKey;
    await save('emailThreads', emailThreadRecordSchema.parse({ key: threadKey, userKey, scopeKey: userKey, accountKey: connectorKey, providerThreadId: `fixture-thread-${index}`, subject: thread.subject, summary: thread.summary, intent: 'informational', priority: 'normal', state: 'informational', lastMessageAt: now, latestFrom: thread.sender, inboxCategory: 'Important', embedding: thread.embedding, embeddingContentVersion: 4, createdAt: now, updatedAt: now }));
    await save('emailMessages', emailMessageRecordSchema.parse({ key: newId(), userKey, scopeKey: userKey, accountKey: connectorKey, threadKey, providerMessageId: `fixture-message-${index}`, from: thread.sender, to: [fixtureEmail], subject: thread.subject, body: thread.body, summary: thread.summary, direction: 'inbound', sentAt: now, hasAttachments: false, embedding: thread.embedding, embeddingContentVersion: 4, createdAt: now, updatedAt: now }));
  }
  await save('emailDrafts', emailDraftRecordSchema.parse({ key: newId(), userKey, scopeKey: userKey, variant: 'new', accountKey: userKey, to: ['rail@example.test'], subject: 'Reply to booking', generatedContent: 'Thank you for confirming my Friday train.', finalContent: 'Thank you for confirming my Friday 09:15 train.', status: 'edited', embedding: vector('railMail'), createdAt: now, updatedAt: now }));
  await save('emailTones', emailToneRecordSchema.parse({ key: newId(), userKey, scopeKey: userKey, name: 'Clear Replies', instruction: 'Keep replies warm and concise.', embedding: vector('inbox'), createdAt: now, updatedAt: now }));

  const travelTagKey = newId();
  await save('tags', tagSchema.parse({ key: travelTagKey, scopeKey, userKey, name: 'Travel', normalizedName: 'travel', description: 'Linked trip plans and visual notes.', embedding: vector('tag'), createdAt: now, updatedAt: now }));
  for (const [sourceType, sourceKey] of [['document', documentKey], ['trip', tripKey], ['image-collection', cityCollectionKey]] as const) await save('tagAssignments', tagAssignmentSchema.parse({ key: newId(), scopeKey, tagKey: travelTagKey, sourceType, sourceKey, source: 'user', createdAt: now }));
  lines.push('Fixture: two albums share one boat image; Aurora Album has two images (3,145,728 bytes) and a memory. City Nights includes a real PNG sign reading KUST 42.', 'Archive has three notes in two folders. Ascend has two audiobooks with chapters. Compass has a two-city trip with folder and album attachments plus saved guidance. Signal has two private threads, a draft, and a tone.', '');

  if (process.env.CORE_QUERY_DRY_RUN === 'true') {
    const { createTravelService } = await import('../src/lib/travel/service');
    const { createEmailService } = await import('../src/lib/email-inbox/service');
    const { createAppSearchService } = await import('../src/lib/app-search/service');
    const { queryWorkspace } = await import('../src/lib/ai/agents/workspace-query');
    const references = await createTravelService().listPlaceReferences({ teamKey, scopeKey, placeKey: stockholmKey, kind: 'restaurants' }, userKey);
    const emails = await createEmailService().overview({ teamKey, scopeKey, userKey }, { connectorKey });
    if (references.references.length !== 1 || emails.threads.length !== 2) throw new Error('The canonical travel or Signal fixture did not converge.');
    lines.push(`Canonical fixture checks: ${references.references.length} Stockholm restaurant reference, ${emails.threads.length} Work Mail threads.`, '');
    const hits = await findWorkspaceGraph('Stockholm', context, 50);
    const emailHits = hits.filter(({ source }) => source === 'emailThreads' || source === 'emailMessages');
    const checkEmail = await Promise.all(emailHits.map(async ({ key, source }) => {
      try { await createAppSearchService().search({ operation: 'get', collectionSlugs: ['email-messages'], key, recordHistory: false }, context); return `${source}:authorized`; }
      catch (error) { return `${source}:${error instanceof Error ? error.message : 'unavailable'}`; }
    }));
    const selected = await queryWorkspace({ requests: [{ operation: 'search', resource: 'workspace', query: 'Stockholm', limit: 10 }] }, context, { message: 'What do my photos, trip, email, and notes jointly tell us about Stockholm?' });
    const overview = selected.results[0];
    lines.push(`Indexed Stockholm source types: ${hits.map(({ source }) => source).join(', ')}`, `Authorized email hits: ${checkEmail.join(', ') || 'none'}`, `Balanced workspace matches: ${overview && 'matches' in overview && Array.isArray(overview.matches) ? overview.matches.map(({ resource }) => resource).join(', ') : 'none'}`, '');
  }

  let failedTurns = 0;
  if (process.env.CORE_QUERY_DRY_RUN !== 'true') {
    // The conversation service persists real messages and typed references between turns.
    const toolCalls: Array<{ name: string; input: unknown; outcome: string; evidence?: string }> = [];
    const freshReadDecisions: Array<{ message: string; required: boolean }> = [];
    const service = createConversationService({
      enqueueArchiveJob: async () => {}, enqueueGuideTopicsJob: async () => {},
      agent: { router: { timeoutMs: 120_000 }, freshReadRequired: async (message, actor, history) => {
        const required = await requiresFreshWorkspaceRead(message, actor, history);
        freshReadDecisions.push({ message, required });
        return required;
      }, tools: { execute: async (name, rawInput, deps) => {
        try {
          const result = await runTool(name, 'agents.core', rawInput, { ...deps, contentContext: context });
          toolCalls.push({ name, input: rawInput, outcome: 'succeeded', ...(name === 'agent.query' ? { evidence: JSON.stringify(result) } : {}) });
          return result;
        } catch (error) {
          toolCalls.push({ name, input: rawInput, outcome: error instanceof Error ? error.message : 'failed' });
          throw error;
        }
      } } },
    });
    const conversation = await service.create({ name: '50-turn live query fixture' }, context);
    const expectedPills = new Map<number, Array<{ collectionSlug: string; key: string }>>([
      [3, [{ collectionSlug: 'memories', key: memoryKey }]],
      [7, [{ collectionSlug: 'images', key: signImageKey }]],
      [8, [{ collectionSlug: 'images', key: secondImageKey }]],
      [11, [{ collectionSlug: 'documents', key: documentKey }]],
      [21, [{ collectionSlug: 'books', key: bookKey }, { collectionSlug: 'books', key: historyBookKey }]],
      [40, [{ collectionSlug: 'email-messages', key: railThreadKey }]],
    ]);
    for (const [sequence, turnNumber] of selectedTurns.entries()) {
      const index = turnNumber - 1, scenario = LIVE_SCENARIOS[index]!;
      const before = toolCalls.length;
      const started = performance.now();
      let answer = '';
      let pills: Array<{ collectionSlug: string; key: string; label: string }> = [];
      let failure: string | undefined;
      try {
        await service.turn({ conversationKey: conversation.key, requestKey: `live-query-${index}-${randomUUID()}`, message: scenario.question }, context, (event) => {
          if (event.type === 'done') {
            answer = event.message.content;
            pills = event.message.retrievals.flatMap(({ groups }) => groups.flatMap(({ collectionSlug, results }) => results.map(({ key, label }) => ({ collectionSlug, key, label }))));
          }
        });
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      const calls = toolCalls.slice(before);
      const readRequired = freshReadDecisions.some((decision) => decision.message === scenario.question && decision.required);
      const missingFacts = scenario.facts.filter((fact) => !fact.test(answer)).map(String);
      const contradictions = (scenario.contradictions ?? []).filter((pattern) => pattern.test(answer)).map(String);
      const missingPills = (expectedPills.get(turnNumber) ?? []).filter(({ collectionSlug, key }) => !pills.some((pill) => pill.collectionSlug === collectionSlug && pill.key === key));
      const passed = !failure && !missingFacts.length && !contradictions.length && !missingPills.length && calls.some((call) => call.name === 'agent.query' && call.outcome === 'succeeded');
      if (!passed) failedTurns++;
      lines.push(`## Turn ${index + 1} · ${scenario.area}`, `User: ${scenario.question}`, `Core: ${answer || '(no completed answer)'}`, `Duration: ${Math.round(performance.now() - started)} ms`,
        `Fresh-read gate: ${readRequired ? 'required' : 'not required'}`,
        `Pills: ${pills.length ? pills.map(({ collectionSlug, label }) => `${collectionSlug}: ${label}`).join('; ') : 'none'}`,
        `Tools: ${calls.length ? calls.map(({ name, input, outcome, evidence }) => `${name} ${JSON.stringify(input)} [${outcome}]${evidence ? ` Evidence: ${evidence}` : ''}`).join('; ') : 'none'}`,
        `Verdict: ${passed ? 'passed' : 'failed'}${missingFacts.length ? ` (missing expected facts: ${missingFacts.join(', ')})` : ''}${contradictions.length ? ` (contradicted: ${contradictions.join(', ')})` : ''}${missingPills.length ? ` (missing navigable pills: ${missingPills.map(({ collectionSlug }) => collectionSlug).join(', ')})` : ''}${failure ? ` (turn error: ${failure})` : ''}`, '');
      await Bun.write(transcriptPath, `${lines.join('\n')}\n`);
      console.log(`Paid Core turn ${sequence + 1}/${selectedTurns.length} (scenario ${turnNumber}): ${passed ? 'passed' : 'failed'} (${Math.round(performance.now() - started)} ms, ${calls.length} tool call(s)).`);
    }
    const persisted = await service.messages({ conversationKey: conversation.key, limit: 100 }, context);
    lines.push(`Persisted conversation messages: ${persisted.items.length}`, `Passed: ${selectedTurns.length - failedTurns}/${selectedTurns.length}`, '');
    if (persisted.items.length !== selectedTurns.length * 2) throw new Error('Not all conversation turn records were persisted.');
  } else lines.push('Dry run: fixture inserted without invoking the paid conversation model.', '');
  const transientKey = newId();
  await db.collection('documents').save(toArangoDoc(documentSchema.parse({ key: transientKey, scopeKey, folderKey, name: 'Luminous Compass', content: 'A disposable index update probe.', embedding: documentEmbedding, createdAt: now, updatedAt: now })));
  const contains = async (name: string) => (await findWorkspaceGraph(name, context)).some((hit) => hit.key === transientKey);
  if (!await contains('Luminous Compass')) throw new Error('A newly created document was not indexed.');
  await db.collection('documents').update(transientKey, { name: 'Amber Horizon', updatedAt: new Date().toISOString() });
  if (await contains('Luminous Compass') || !await contains('Amber Horizon')) throw new Error('An edited document remained stale in the search view.');
  await db.collection('documents').remove(transientKey);
  if (await contains('Amber Horizon')) throw new Error('A deleted document remained in the search view.');
  lines.push('Native index create/edit/delete check: passed', '');
  await Bun.write(transcriptPath, `${lines.join('\n')}\n`);
  console.log(process.env.CORE_QUERY_DRY_RUN === 'true' ? 'Core query fixture dry run saved.' : `Live Core query transcript saved (${selectedTurns.length - failedTurns}/${selectedTurns.length} passed).`);
  if (failedTurns) process.exitCode = 1;
} catch (error) {
  lines.push(`Run failed: ${error instanceof Error ? error.message : String(error)}`, '');
  await Bun.write(transcriptPath, `${lines.join('\n')}\n`);
  throw error;
} finally {
  if (removeStoredObjects) await removeStoredObjects().catch((error) => console.error('Failed to clean up temporary local S3 object', error));
  if (created) await system.dropDatabase(databaseName);
  system.close();
}
