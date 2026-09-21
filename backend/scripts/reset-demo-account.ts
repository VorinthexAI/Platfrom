import { hashUserEmail, normalizeEmail } from '@/api/users';
import { ACCOUNT_DELETE_CONFIRMATION, accountDeletionService } from '@/lib/account-deletion/service';
import { runContentTool, runTool } from '@/lib/ai/tools';
import { toolEventService } from '@/lib/ai/events/service';
import { defaultBookService } from '@/lib/books/default-service';
import { sparksToMicroSparks } from '@/lib/costs';
import { closeDb, db } from '@/lib/db/client';
import { getPersonalAuthContext, provisionPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { getUserByEmailHash } from '@/lib/db/users.node';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { encryptEmailConnectorCredentials, tokenFingerprint } from '@/lib/email-inbox/connector-crypto';
import { mailDevAttachmentFile } from '@/lib/email-inbox/dev-attachment-files';
import { MAIL_DEV_FIXTURE_AT, MAIL_DEV_FIXTURE_PREFIX } from '@/lib/email-inbox/dev-fixtures';
import { assertLocalMailSeedEnvironment, buildMailDevSeedManifest, reconcileMailDevSeed, verifyMailDevSeed } from '@/lib/email-inbox/dev-seed';
import { S3_BUCKET } from '@/lib/s3';
import { sparkService } from '@/lib/sparks/service';
import { upsertUserByEmail } from '@/lib/accounts/service';

export const DEMO_EMAIL = 'oscar.burman005@gmail.com';
export const DEMO_NAME = 'Atlas';
export const DEMO_SPARK_BALANCE = 689;

const ARCHIVE = [
  { name: 'Weekly Planning', description: 'Plans, reviews, and focused priorities.', notes: [['This Week', 'Choose three priorities, protect one focused block each morning, collect errands in one place, and review what changed on Friday.'], ['Sunday Reset', '# Sunday reset\n\n- Review the week\n- Plan meals\n- Clear the inbox\n- Choose next week\'s priorities']] },
  { name: 'Home and Admin', description: 'Household records and practical checklists.', notes: [['Apartment Renewal Checklist', 'Confirm the renewal date, compare utilities, photograph any maintenance issues, update the household calendar, and set aside time to read the agreement before signing.'], ['Monthly Household Plan', 'This month focuses on keeping ordinary life calm and visible. Review recurring payments, refill household supplies before they become urgent, plan two simple meals that create leftovers, and put repairs into one small list. The goal is not to optimize every task. It is to reduce the number of decisions that return unexpectedly during a busy week.']] },
  { name: 'Learning Notes', description: 'Reading notes and skills worth revisiting.', notes: [['Notes on Better Habits', 'Small habits become easier when the environment makes the next useful action obvious. Keep the first step visible, lower the friction, and review the system before blaming motivation.'], ['Personal Knowledge System', 'A useful knowledge system needs a clear capture point, a weekly review, and a small number of places where active work can live. Save source material with enough context to explain why it mattered. Write short summaries in your own words. Link decisions to the notes that informed them. During a weekly review, promote the few ideas that are ready for action and archive the rest without guilt. The system should make future work easier, not become another project to maintain.']] },
  { name: 'Travel Ideas', description: 'Future trips, packing lists, and travel research.', notes: [['Weekend Packing List', 'Passport, charger, walking shoes, refillable bottle, light layer, medication, headphones, and a small notebook.'], ['Travel Planning Principles', 'Build a trip around a few places that genuinely matter instead of trying to see every landmark. Leave room for slower mornings, a meal without a reservation, and the possibility that a neighborhood is more interesting than the original plan. Keep transit times visible, save addresses before leaving WiFi, and choose one small daily ritual that makes the trip feel memorable.']] },
  { name: 'Personal Projects', description: 'Longer projects, decisions, and next actions.', notes: [['Personal Website Refresh', 'The website refresh should make it easy for someone to understand the work, find one useful example, and get in touch. Start with a small outline, use plain language, and publish before every detail is perfect. The next steps are to gather three examples, write short introductions, choose a simple visual direction, and reserve a focused Saturday morning for the first draft.'], ['Decision Journal', 'Record important decisions with the context available at the time, the tradeoffs considered, and the first signal that would show the decision needs revisiting. This keeps hindsight from rewriting the original reasoning.']] },
] as const;

const COMPASS_COUNTRIES = [
  { name: 'Portugal', continent: 'Europe', cities: ['Lisbon', 'Porto'] },
  { name: 'Japan', continent: 'Asia', cities: ['Kyoto', 'Tokyo'] },
  { name: 'Denmark', continent: 'Europe', cities: ['Copenhagen', 'Aarhus'] },
] as const;

const TRIPS = [
  ['Lisbon and Porto', 'A relaxed route through Lisbon and Porto, balancing food, walks, and unhurried city time.', ['Lisbon', 'Porto']],
  ['Kyoto and Tokyo', 'A first trip through Kyoto and Tokyo, combining calm traditions with energetic city life.', ['Kyoto', 'Tokyo']],
  ['Copenhagen and Aarhus', 'A design-focused Danish weekend between Copenhagen and Aarhus.', ['Copenhagen', 'Aarhus']],
] as const;

const BOOKS = [
  ['A calmer weekly planning system', 'Build a weekly rhythm that protects priorities without becoming rigid.'],
  ['Practical personal knowledge management', 'Capture, organize, and reuse useful information without creating a second job.'],
  ['Better everyday habits', 'Create sustainable habits by changing cues, friction, and review routines.'],
  ['Simple weeknight cooking', 'Cook dependable, healthy meals with practical shopping and preparation habits.'],
  ['Focused work in a distracted world', 'Create a realistic practice for starting, protecting, and finishing focused work.'],
  ['Personal finance foundations', 'Build a clear, low stress approach to spending, saving, and planning.'],
] as const;

function assertLocalEnvironment() {
  assertLocalMailSeedEnvironment(process.env);
  if (S3_BUCKET !== 'vorinthex-dev') throw new Error('Demo reset may only use the vorinthex-dev bucket.');
  const hostname = new URL(process.env.S3_ENDPOINT_URL ?? process.env.AWS_ENDPOINT_URL ?? '').hostname;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && !hostname.startsWith('192.168.')) throw new Error('Demo reset requires a local S3 endpoint.');
}

function sampleBooks() {
  const values = [...BOOKS].sort(() => Math.random() - 0.5);
  return values.slice(0, 3 + Math.floor(Math.random() * 3));
}

async function seedSignal(userKey: string, teamKey: string, scopeKey: string, membershipKey: string) {
  const placeholder = `local-fixture:${scopeKey}`;
  const manifest = buildMailDevSeedManifest({
    userKey, teamKey, scopeKey, membershipKey,
    credentials: (_accountKey, providerAccountId) => ({ ...encryptEmailConnectorCredentials({ accessToken: placeholder, tokenType: 'Fixture', expiresAt: MAIL_DEV_FIXTURE_AT }, { teamKey, scopeKey, providerAccountId }), accessTokenFingerprint: tokenFingerprint(placeholder) }),
  });
  for (const attachment of manifest.emailAttachments) {
    const file = mailDevAttachmentFile(attachment.kind, attachment.filename);
    await documentStorage.upload({ key: attachment.storageKey!, bytes: file.bytes, mimeType: attachment.mimeType });
  }
  await reconcileMailDevSeed(db, manifest);
  return verifyMailDevSeed(db, manifest);
}

function generatedPlaceInput(detail: { title: string; summary: string; location: { countryCode: string; latitude: number; longitude: number }; imageRequestToken: string }) {
  return { name: detail.title, summary: detail.summary, countryCode: detail.location.countryCode, latitude: detail.location.latitude, longitude: detail.location.longitude, imageRequestToken: detail.imageRequestToken };
}

async function seedCompass(context: Parameters<typeof runTool>[3]['contentContext'], userKey: string) {
  const places = new Map<string, string>();
  for (const fixture of COMPASS_COUNTRIES) {
    const countryResult = await runTool('country.search', '', { query: fixture.name }, { contentContext: context, requestKey: `demo-reset:${userKey}:country:${fixture.name}`, recordEvent: toolEventService.record }) as { country: { name: string; countryCode: string; latitude: number; longitude: number } | null };
    if (!countryResult.country) throw new Error(`Could not resolve Compass country ${fixture.name}.`);
    const country = { name: countryResult.country.name, code: countryResult.country.countryCode, continent: fixture.continent, lat: countryResult.country.latitude, lon: countryResult.country.longitude };
    const guide = await runTool('place.guide.find', '', { query: country.name, country }, { contentContext: context, requestKey: `demo-reset:${userKey}:guide:${country.code}`, recordEvent: toolEventService.record }) as { place: Parameters<typeof generatedPlaceInput>[0] };
    const savedCountry = await runTool('place.create', '', generatedPlaceInput(guide.place), { contentContext: context, requestKey: `demo-reset:${userKey}:place:${country.code}`, recordEvent: toolEventService.record }) as { place: { key: string; coverUrl?: string } };
    if (!savedCountry.place.coverUrl) throw new Error(`Compass country ${country.name} was created without a generated hero image.`);
    places.set(country.name, savedCountry.place.key);
    for (const city of fixture.cities) {
      const cityGuide = await runTool('place.find-city', '', { city, country }, { contentContext: context, requestKey: `demo-reset:${userKey}:guide:${country.code}:${city}`, recordEvent: toolEventService.record }) as { city: Parameters<typeof generatedPlaceInput>[0] };
      const savedCity = await runTool('place.create', '', generatedPlaceInput(cityGuide.city), { contentContext: context, requestKey: `demo-reset:${userKey}:place:${country.code}:${city}`, recordEvent: toolEventService.record }) as { place: { key: string; coverUrl?: string } };
      if (!savedCity.place.coverUrl) throw new Error(`Compass city ${city} was created without a generated hero image.`);
      places.set(city, savedCity.place.key);
    }
  }
  return places;
}

async function verifyCompass(scopeKey: string, userKey: string, expectedPlaceCount: number) {
  const cursor = await db.query<{ key: string; generatedDetail: unknown; heroStorageKey: string | null }>('FOR place IN places FILTER place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true LET hero = FIRST(FOR media IN placeHeroMedia FILTER media.placeKey == place._key && media.scopeKey == @scopeKey && media.userKey == @userKey LIMIT 1 RETURN media.storageKey) RETURN { key: place._key, generatedDetail: place.generatedDetail, heroStorageKey: hero }', { scopeKey, userKey });
  const places = await cursor.all();
  if (places.length !== expectedPlaceCount) throw new Error(`Expected ${expectedPlaceCount} generated Compass places, found ${places.length}.`);
  for (const place of places) {
    if (!place.generatedDetail || !place.heroStorageKey) throw new Error(`Compass place ${place.key} is missing generated detail or a hero image.`);
    const image = await documentStorage.download(place.heroStorageKey);
    if (image.bytes.byteLength <= 1_024) throw new Error(`Compass place ${place.key} has an invalid hero image.`);
  }
}

async function verifyBooks(bookKeys: readonly string[], teamKey: string, scopeKey: string, userKey: string) {
  for (const key of bookKeys) {
    const detail = await defaultBookService.detail(key, { teamKey, scopeKey }, userKey);
    if (detail.book.status !== 'ready' || !detail.book.coverUrl || detail.chapters.length !== detail.book.chapterCount || detail.chapters.some((chapter) => !chapter.content || !chapter.audioUrl)) throw new Error(`Audio book ${key} did not complete with generated cover, text, and audio.`);
  }
}

async function main() {
  assertLocalEnvironment();
  const email = normalizeEmail(DEMO_EMAIL);
  const existing = await getUserByEmailHash(await hashUserEmail(email));
  if (existing) await accountDeletionService.delete({ confirmation: ACCOUNT_DELETE_CONFIRMATION }, existing.key, { sendConfirmation: false });
  const user = await upsertUserByEmail(email, { name: DEMO_NAME });
  const personal = await getPersonalAuthContext(user.key) ?? await provisionPersonalAuthContext(user);
  const context = { teamKey: personal.team.key, runtimeScopeKey: personal.scope.key, principal: { kind: 'member' as const, user, userTeam: personal.membership, scopeMember: personal.scopeMembership } };
  const balance = await sparkService.getBalance(user.key) ?? 0;
  const target = sparksToMicroSparks(DEMO_SPARK_BALANCE);
  if (balance !== target) await sparkService.adjust(user.key, { deltaMicroSparks: target - balance, idempotencyKey: `demo-reset:${user.key}:balance`, requestHash: `demo-reset-balance:${DEMO_SPARK_BALANCE}` });

  for (const folder of ARCHIVE) {
    const created = await runContentTool('folder.create', { folders: [{ scopeKey: personal.scope.key, name: folder.name, description: folder.description }] }, context);
    const folderKey = created.results[0]?.data?.folder.key;
    if (!folderKey) throw new Error(`Could not create Archive folder ${folder.name}.`);
    for (const [name, content] of folder.notes) await runContentTool('document.create', { scopeKey: personal.scope.key, folderKey, name, content }, context);
  }

  const compassPlaces = await seedCompass(context, user.key);
  await verifyCompass(personal.scope.key, user.key, compassPlaces.size);
  for (const [name, description, placeNames] of TRIPS) {
    const placeKeys = placeNames.map((placeName) => compassPlaces.get(placeName));
    if (placeKeys.some((key) => !key)) throw new Error(`Could not resolve Compass places for trip ${name}.`);
    await runTool('trip.create', '', { name, description, placeKeys }, { contentContext: context, requestKey: `demo-reset:${user.key}:trip:${name}`, recordEvent: toolEventService.record });
  }

  const books = defaultBookService;
  const selectedBooks = sampleBooks();
  const bookKeys: string[] = [];
  for (const [topic, goal] of selectedBooks) {
    const created = await runTool('book.create', '', { topic, goal, currentKnowledge: 'A motivated beginner who wants practical routines they can use this week.', writingTone: 'Clear, warm, practical, and encouraging', language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear', narrationPace: 1 }, { contentContext: context, bookService: books, requestKey: `demo-reset:${user.key}:book:${topic}`, recordEvent: toolEventService.record }) as { key: string };
    bookKeys.push(created.key);
  }
  const deadline = Date.now() + 45 * 60_000;
  const statuses = new Map(bookKeys.map((key) => [key, 'queued']));
  while (statuses.size && Date.now() < deadline) {
    for (const key of [...statuses.keys()]) {
      const detail = await books.detail(key, { teamKey: personal.team.key, scopeKey: personal.scope.key }, user.key);
      if (detail.book.status === 'ready' || detail.book.status === 'failed' || detail.book.status === 'cancelled') statuses.delete(key);
    }
    if (statuses.size) await Bun.sleep(2_000);
  }
  if (statuses.size) throw new Error(`Timed out waiting for ${statuses.size} audio book generations.`);
  await verifyBooks(bookKeys, personal.team.key, personal.scope.key, user.key);
  const signal = await seedSignal(user.key, personal.team.key, personal.scope.key, personal.membership.key);
  const finalBalance = await sparkService.getBalance(user.key);
  console.log(JSON.stringify({ email, name: DEMO_NAME, userKey: user.key, teamKey: personal.team.key, scopeKey: personal.scope.key, archiveFolders: ARCHIVE.length, archiveDocuments: ARCHIVE.reduce((sum, folder) => sum + folder.notes.length, 0), places: compassPlaces.size, trips: TRIPS.length, books: bookKeys.length, signal, sparkBalance: finalBalance === null ? null : finalBalance / 1_000_000, signalFixture: MAIL_DEV_FIXTURE_PREFIX }, null, 2));
}

let failed = false;
try { await main(); } catch (error) { failed = true; console.error(error); } finally { await closeDb(); }
process.exit(failed ? 1 : 0);
