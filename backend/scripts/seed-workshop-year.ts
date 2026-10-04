import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { db, closeDb } from '@/lib/db/client';
import { deleteFileInScope, fileStorageKey, fileThumbnailStorageKey, getFileInScope, insertFile, updateFile, type FileExtension } from '@/lib/db/files.node';
import { getFolderById, insertFolder } from '@/lib/db/folders.node';
import { memberPrincipal, type ToolContext } from '@/lib/ai/tools/tool-context';
import { scopeService } from '@/lib/ai/scopes/service';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { redisConnection } from '@/lib/redis';
import { ingestExtractedText } from '@/lib/ai/tools/content-runtime';
import { processStoredMedia } from '@/lib/ai/document-processing/media-caption';
import { generateAgentImage, generateAgentSpeech, generateAgentVideo } from '@/lib/ai/agents/media';
import { targetDevUser } from './dev/files-environment';
import { seedWorkshopChats } from './dev/workshop-chat-fixtures';
import { docxBytes, pdfBytes } from './dev/document-formats';
import { WORKSHOP_SCOPE_MARKER, WORKSHOP_SCOPE_NAME, workshopAudio, workshopDocuments, workshopFolders, workshopImages, workshopLocation, workshopStableKey as stableKey, workshopVideos } from './dev/workshop-year';

const assetDirectory = join(import.meta.dir, 'dev', 'assets');
const requestKey = (userKey: string, name: string) => `dev:workshop-year-v1:${userKey}:${name}`;
const generatedKey = (request: string) => `c${createHash('sha256').update(request).digest('hex').slice(0, 24)}`;

async function cacheMedia(name: string, key: string, context: ToolContext) {
  const file = await getFileInScope(context.runtimeScopeKey, key, context.userKey);
  if (!file) throw new Error(`Generated file ${name} was not persisted.`);
  const path = join(assetDirectory, `${name}.${file.extension}`);
  if (!await Bun.file(path).exists()) await Bun.write(path, (await documentStorage.download(file.storageKey)).bytes);
  if (file.name !== name) await updateFile(file.key, { name });
  return file.key;
}

async function ensureVideoThumbnail(videoKey: string, startingImageKey: string, context: ToolContext) {
  const video = await getFileInScope(context.runtimeScopeKey, videoKey, context.userKey);
  const image = await getFileInScope(context.runtimeScopeKey, startingImageKey, context.userKey);
  if (!video || video.extension !== 'mp4' || !image) throw new Error('The video or its starting image is missing.');
  if (video.thumbnailStorageKey) return;
  const source = await documentStorage.download(image.thumbnailStorageKey ?? image.storageKey);
  const bytes = await sharp(source.bytes).resize({ width: 512 }).jpeg({ quality: 82 }).toBuffer();
  const thumbnailStorageKey = fileThumbnailStorageKey(context.userKey, videoKey);
  await documentStorage.upload({ key: thumbnailStorageKey, bytes, mimeType: 'image/jpeg', billingUserKey: context.userKey });
  try { await updateFile(videoKey, { thumbnailStorageKey }); }
  catch (error) { await documentStorage.delete(thumbnailStorageKey).catch(() => undefined); throw error; }
}

async function placeFixture(key: string, folderKey: string | undefined, context: ToolContext) {
  const file = await getFileInScope(context.runtimeScopeKey, key, context.userKey);
  if (!file) throw new Error(`Fixture file ${key} is missing.`);
  if (file.folderKey === folderKey) return;
  if (folderKey) { await updateFile(key, { folderKey }); return; }
  const updated = await db.query(`FOR file IN files
    FILTER file._key == @key && file.userKey == @userKey && file.scopeKey == @scopeKey
    UPDATE file WITH { folderKey: null, updatedAt: @now } IN files OPTIONS { keepNull: false }
    RETURN 1`, { key, userKey: context.userKey, scopeKey: context.runtimeScopeKey, now: new Date().toISOString() });
  if (!await updated.next()) throw new Error(`Could not move fixture file ${key} to the root.`);
}

async function removeEmptyLegacyFolders(userKey: string, scopeKey: string) {
  const current = new Set(workshopFolders.map(({ name }) => name));
  const previous = new Set([...workshopDocuments.map(({ folder }) => folder), ...workshopImages.map(({ folder }) => folder), 'Voice Notes', 'Short Films']);
  for (const name of previous) {
    if (current.has(name)) continue;
    const key = stableKey(`${userKey}:${scopeKey}:folder:${name}`);
    await db.query(`LET folder = DOCUMENT(folders, @key)
      FILTER folder != null && folder.userKey == @userKey && folder.scopeKey == @scopeKey && folder.name == @name
      FILTER LENGTH(FOR file IN files FILTER file.scopeKey == @scopeKey && file.folderKey == @key LIMIT 1 RETURN 1) == 0
      FILTER LENGTH(FOR child IN folders FILTER child.scopeKey == @scopeKey && child.parentFolderKey == @key LIMIT 1 RETURN 1) == 0
      REMOVE folder IN folders`, { key, name, userKey, scopeKey });
  }
}

async function restoreCached(name: string, extensions: readonly FileExtension[], folderKey: string, context: ToolContext, caption: string, spokenText?: string) {
  const key = generatedKey(requestKey(context.userKey, name));
  const existing = await getFileInScope(context.runtimeScopeKey, key, context.userKey);
  if (existing) {
    if (existing.processing === 'failed') await processStoredMedia(existing, context, spokenText ? { spokenText } : {});
    await cacheMedia(name, key, context);
    return key;
  }
  for (const extension of extensions) {
    const path = join(assetDirectory, `${name}.${extension}`);
    if (!await Bun.file(path).exists()) continue;
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const mimeType = extension === 'mp3' ? 'audio/mpeg' : extension === 'mp4' ? 'video/mp4' : `image/${extension}`;
    const storageKey = fileStorageKey(context.userKey, key, extension);
    const thumbnailStorageKey = ['png', 'jpeg', 'webp'].includes(extension) ? fileThumbnailStorageKey(context.userKey, key) : undefined;
    try {
      await documentStorage.upload({ key: storageKey, bytes, mimeType, billingUserKey: context.userKey });
      if (thumbnailStorageKey) await documentStorage.upload({ key: thumbnailStorageKey, bytes: await sharp(bytes).resize({ width: 512 }).jpeg({ quality: 82 }).toBuffer(), mimeType: 'image/jpeg', billingUserKey: context.userKey });
      const now = new Date().toISOString();
      const file = await insertFile({ key, userKey: context.userKey, scopeKey: context.runtimeScopeKey, folderKey, name, extension, mimeType, sizeBytes: bytes.length, storageKey, ...(thumbnailStorageKey ? { thumbnailStorageKey } : {}), caption, processing: 'pending', isFavorite: false, isHidden: false, createdAt: now, updatedAt: now });
      await processStoredMedia(file, context, spokenText ? { spokenText } : {});
      return file.key;
    } catch (error) {
      await documentStorage.delete(storageKey).catch(() => undefined);
      if (thumbnailStorageKey) await documentStorage.delete(thumbnailStorageKey).catch(() => undefined);
      throw error;
    }
  }
  return null;
}

async function main() {
  const user = await targetDevUser(process.argv.slice(2));
  if (workshopDocuments.length !== 30 || workshopImages.length !== 20 || workshopAudio.length !== 10 || workshopVideos.length !== 5) throw new Error('The Workshop Year manifest must contain exactly 65 files.');
  const base: ToolContext = { userKey: user.key, teamKey: user.key, runtimeScopeKey: user.currentScopeKey, principal: memberPrincipal(user) };
  let scopes = (await scopeService.list(base)).scopes;
  let scope = scopes.find(({ slug }) => slug === 'the-workshop-year');
  if (scope && scope.description !== WORKSHOP_SCOPE_MARKER) throw new Error('The Workshop Year scope belongs to other content; refusing to reuse it.');
  if (!scope) scope = (await scopeService.create({ name: WORKSHOP_SCOPE_NAME, description: WORKSHOP_SCOPE_MARKER }, base)).scope;
  const context = { ...base, runtimeScopeKey: scope.key };
  await mkdir(assetDirectory, { recursive: true });

  const folders = new Map<string, string>();
  for (const { name, ...placement } of workshopFolders) {
    const key = stableKey(`${user.key}:${scope.key}:folder:${name}`);
    const parentFolderKey = 'parent' in placement ? folders.get(placement.parent) : undefined;
    if ('parent' in placement && !parentFolderKey) throw new Error(`Missing parent for ${name}.`);
    const found = await getFolderById(key);
    if (found && (found.userKey !== user.key || found.scopeKey !== scope.key || found.name !== name || found.parentFolderKey !== parentFolderKey)) throw new Error(`Folder key collision: ${name}.`);
    if (!found) {
      const now = new Date().toISOString();
      await insertFolder({ key, userKey: user.key, scopeKey: scope.key, ...(parentFolderKey ? { parentFolderKey } : {}), name, description: `The Workshop Year — ${name}`, embedding: [], isFavorite: false, isHidden: false, createdAt: now, updatedAt: now });
    }
    folders.set(name, key);
  }

  // Retire six earlier Markdown/text fixture names when upgrading an existing seed.
  for (const oldName of ['conversation-with-iman.md', 'neighborhood-survey.txt', 'supplier-quotes.md', 'weekly-opening-plan.md', 'meeting-notes-april.md', 'opening-announcement.md']) {
    const key = stableKey(`${user.key}:${scope.key}:document:${oldName}`);
    if (await getFileInScope(scope.key, key, user.key)) await deleteFileInScope(scope.key, key, user.key);
  }

  for (const [index, item] of workshopDocuments.entries()) {
    const key = stableKey(`${user.key}:${scope.key}:document:${item.name}`);
    const existing = await getFileInScope(scope.key, key, user.key);
    const folderName = workshopLocation('document', index);
    const folderKey = folderName ? folders.get(folderName)! : undefined;
    const extension = item.name.split('.').at(-1) as 'txt' | 'md' | 'docx' | 'pdf';
    const text = `${item.text}\n\nFiled ${item.date} by Mara Vale. Fictional Workshop Year field notes.\n`;
    if (!existing) {
      const bytes = extension === 'pdf' ? pdfBytes(text) : extension === 'docx' ? await docxBytes(text) : Buffer.from(text, 'utf8');
      const storageKey = fileStorageKey(user.key, key, extension);
      const mimeType = { md: 'text/markdown', txt: 'text/plain', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }[extension];
      await documentStorage.upload({ key: storageKey, bytes, mimeType, billingUserKey: user.key });
      try {
        const now = new Date().toISOString();
        await insertFile({ key, userKey: user.key, scopeKey: scope.key, ...(folderKey ? { folderKey } : {}), name: item.name.replace(/\.[^.]+$/, ''), extension, mimeType, sizeBytes: bytes.length, storageKey, processing: 'pending', isFavorite: false, isHidden: false, createdAt: now, updatedAt: now });
      } catch (error) { await documentStorage.delete(storageKey).catch(() => undefined); throw error; }
    }
    if (existing?.processing !== 'ready') await ingestExtractedText(key, text);
    await placeFixture(key, folderKey, context);
    console.log(`document ${item.name}`);
  }

  const imageKeys = new Map<string, string>();
  for (const [index, item] of workshopImages.entries()) {
    const folderName = workshopLocation('image', index);
    const folderKey = folderName ? folders.get(folderName)! : undefined;
    const key = await restoreCached(item.name, ['png', 'jpeg', 'webp'], folderKey, context, item.prompt)
      ?? (await generateAgentImage({ prompt: item.prompt, folderKey }, context, { requestKey: requestKey(user.key, item.name) })).files[0]!.key;
    imageKeys.set(item.name, await cacheMedia(item.name, key, context));
    await placeFixture(key, folderKey, context);
    console.log(`image ${item.name}`);
  }
  for (const [index, item] of workshopAudio.entries()) {
    const folderName = workshopLocation('audio', index);
    const folderKey = folderName ? folders.get(folderName)! : undefined;
    const key = await restoreCached(item.name, ['mp3'], folderKey, context, item.text, item.text)
      ?? (await generateAgentSpeech({ text: item.text, voice: item.voice, folderKey }, context, { requestKey: requestKey(user.key, item.name) })).files[0]!.key;
    await cacheMedia(item.name, key, context);
    await placeFixture(key, folderKey, context);
    console.log(`audio ${item.name} (source: ${item.source})`);
  }
  for (const [index, item] of workshopVideos.entries()) {
    const folderName = workshopLocation('video', index);
    const folderKey = folderName ? folders.get(folderName)! : undefined;
    const startingImageKey = imageKeys.get(item.image)!;
    const key = await restoreCached(item.name, ['mp4'], folderKey, context, item.prompt)
      ?? (await generateAgentVideo({ prompt: item.prompt, startFrameFileKey: startingImageKey, durationSeconds: 5, aspectRatio: '16:9', folderKey }, context, { requestKey: requestKey(user.key, item.name) })).files[0]!.key;
    await ensureVideoThumbnail(key, startingImageKey, context);
    await cacheMedia(item.name, key, context);
    await placeFixture(key, folderKey, context);
    console.log(`video ${item.name}`);
  }
  // Media capabilities start caption/embedding in the background. Wait for the
  // final video too, before the short-lived CLI closes its provider connections.
  let pending = 0;
  let failed = 0;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const statuses = await db.query('FOR file IN files FILTER file.userKey == @userKey && file.scopeKey == @scopeKey && file.extension IN ["png", "jpeg", "webp", "mp3", "mp4"] COLLECT status = file.processing WITH COUNT INTO count RETURN { status, count }', { userKey: user.key, scopeKey: scope.key });
    const values = await statuses.all() as Array<{ status: string; count: number }>;
    pending = values.find(({ status }) => status === 'pending')?.count ?? 0;
    failed = values.find(({ status }) => status === 'failed')?.count ?? 0;
    if (!pending) break;
    await Bun.sleep(2_000);
  }
  if (pending || failed) throw new Error(`Media indexing did not complete: ${pending} pending, ${failed} failed. Re-run the seed to retry.`);
  await removeEmptyLegacyFolders(user.key, scope.key);
  await seedWorkshopChats(context);
  // Core reads the current scope. Switch to the new story once all assets exist.
  await scopeService.select({ targetScopeKey: scope.key }, context);
  const result = await db.query('FOR file IN files FILTER file.userKey == @userKey && file.scopeKey == @scopeKey COLLECT extension = file.extension WITH COUNT INTO count RETURN { extension, count }', { userKey: user.key, scopeKey: scope.key });
  console.log(JSON.stringify({ scope: scope.name, files: await result.all() }));
}

if (import.meta.main) {
  try { await main(); }
  catch (error) { console.error(error); process.exitCode = 1; }
  finally { redisConnection.disconnect(); await closeDb(); }
  process.exit(process.exitCode ?? 0);
}
