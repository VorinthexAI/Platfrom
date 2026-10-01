import { z } from 'zod';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { executeAction } from '@/lib/ai/router';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { fileStorageKey, fileThumbnailStorageKey, getFileInScope, insertFile } from '@/lib/db/files.node';
import { getFolderInScope } from '@/lib/db/folders.node';
import { imageOutputSchema, type ImageOutput } from '@/lib/ai/providers/types';
import { speechOutputSchema, type SpeechOutput } from '@/lib/ai/actions/speech';
import { videoOutputSchema, type VideoOutput } from '@/lib/ai/actions/video';
import type { ExecuteActionOptions } from '@/lib/ai/router';
import { processStoredMedia } from '@/lib/ai/document-processing/media-caption';
import { publicContentFile } from '@/lib/ai/tools/content-runtime';
import { sendGeneratedFilePush } from '@/lib/app-notifications/generated-file';

const imageKey = z.string().cuid();
export const agentImageInputSchema = z.object({ prompt: z.string().trim().min(1).max(4_000), referenceImageKeys: z.array(imageKey).max(8).refine((keys) => new Set(keys).size === keys.length).default([]), folderKey: imageKey.optional() }).strict();
export const agentSpeechInputSchema = z.object({ text: z.string().trim().min(1).max(15_000), voice: z.enum(['eve', 'ara', 'rex', 'sal', 'leo']), folderKey: imageKey.optional() }).strict();
export const agentVideoInputSchema = z.object({ prompt: z.string().trim().min(1).max(4_000), startFrameFileKey: imageKey.optional(), durationSeconds: z.number().int().min(5).max(15), aspectRatio: z.enum(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']), folderKey: imageKey.optional() }).strict();

async function authorizeOutputFolder(folderKey: string | undefined, context: ToolContext) {
  if (folderKey && !await getFolderInScope(context.runtimeScopeKey, folderKey, contextUserKey(context))) throw new Error('The destination folder is not available in this scope.');
}

async function imageReference(key: string, context: ToolContext) {
  const file = await getFileInScope(context.runtimeScopeKey, key, contextUserKey(context));
  if (!file || !['jpg', 'jpeg', 'png', 'webp'].includes(file.extension)) throw new Error('The referenced image is not available in this scope.');
  const object = await documentStorage.download(file.storageKey);
  if (object.bytes.length > 20 * 1024 * 1024) throw new Error('The referenced image is too large.');
  return `data:${file.mimeType};base64,${Buffer.from(object.bytes).toString('base64')}`;
}

function mediaKey(requestKey: string) { return `c${createHash('sha256').update(requestKey).digest('hex').slice(0, 24)}`; }

async function savedMedia(context: ToolContext, requestKey: string, folderKey?: string) {
  const file = await getFileInScope(context.runtimeScopeKey, mediaKey(requestKey), contextUserKey(context));
  if (file && file.folderKey !== folderKey) throw new Error('This request key was already used in another folder.');
  return file ? publicContentFile(file) : null;
}

async function announceCompletion(fileKey: string, kind: 'image' | 'video' | 'speech', context: ToolContext) {
  try { await sendGeneratedFilePush(fileKey, kind, context); }
  catch (error) { console.error('generated media completion notification failed', { fileKey, kind, error }); }
}

async function saveMedia(context: ToolContext, requestKey: string, bytes: Uint8Array, extension: 'png' | 'jpeg' | 'webp' | 'mp3' | 'mp4', mimeType: string, title: string, folderKey?: string, spokenText?: string) {
  await authorizeOutputFolder(folderKey, context);
  const userKey = contextUserKey(context);
  const key = mediaKey(requestKey);
  const existing = await savedMedia(context, requestKey, folderKey);
  if (existing) return existing;
  const storageKey = fileStorageKey(userKey, key, extension);
  const thumbnailStorageKey = extension === 'png' || extension === 'jpeg' || extension === 'webp' ? fileThumbnailStorageKey(userKey, key) : undefined;
  try {
    await documentStorage.upload({ key: storageKey, bytes, mimeType, billingUserKey: userKey });
    if (thumbnailStorageKey) {
      const thumbnailBytes = await sharp(bytes).resize({ width: 512 }).jpeg({ quality: 82 }).toBuffer();
      await documentStorage.upload({ key: thumbnailStorageKey, bytes: thumbnailBytes, mimeType: 'image/jpeg', billingUserKey: userKey });
    }
    const timestamp = new Date().toISOString();
    const file = await insertFile({ key, userKey, scopeKey: context.runtimeScopeKey, ...(folderKey ? { folderKey } : {}), name: title.slice(0, 100), extension, mimeType, sizeBytes: bytes.length, storageKey, ...(thumbnailStorageKey ? { thumbnailStorageKey } : {}), processing: 'pending', isFavorite: false, isHidden: false, createdAt: timestamp, updatedAt: timestamp });
    void processStoredMedia(file, context, spokenText ? { spokenText } : {});
    return publicContentFile(file);
  } catch (error) {
    await Promise.all([storageKey, thumbnailStorageKey].filter((value): value is string => Boolean(value)).map((value) => documentStorage.delete(value).catch(() => undefined)));
    throw error;
  }
}

export async function generateAgentImage(raw: unknown, context: ToolContext, options: ExecuteActionOptions & { requestKey: string }) {
  const input = agentImageInputSchema.parse(raw);
  await authorizeOutputFolder(input.folderKey, context);
  const existing = await savedMedia(context, options.requestKey, input.folderKey);
  if (existing) { await announceCompletion(existing.key, 'image', context); return { files: [existing] }; }
  const refs = await Promise.all(input.referenceImageKeys.map((key) => imageReference(key, context)));
  const response = await executeAction<unknown, ImageOutput>({ mode: 'auto', teamKey: context.teamKey, actionSlug: 'image' }, { operation: 'generate', prompt: input.prompt, count: 1, ...(refs.length ? { inputReferences: refs } : {}) }, { ...options, providers: ['image.primary'] });
  const image = imageOutputSchema.parse(response.output).images[0]!;
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' } as const;
  const file = await saveMedia(context, options.requestKey, Buffer.from(image.base64, 'base64'), extension[image.mimeType], image.mimeType, input.prompt, input.folderKey);
  await announceCompletion(file.key, 'image', context);
  return { files: [file] };
}

export async function generateAgentSpeech(raw: unknown, context: ToolContext, options: ExecuteActionOptions & { requestKey: string }) {
  const input = agentSpeechInputSchema.parse(raw);
  await authorizeOutputFolder(input.folderKey, context);
  const existing = await savedMedia(context, options.requestKey, input.folderKey);
  if (existing) { await announceCompletion(existing.key, 'speech', context); return { files: [existing] }; }
  const response = await executeAction<unknown, SpeechOutput>({ mode: 'auto', teamKey: context.teamKey, actionSlug: 'speech' }, { text: input.text, voice: input.voice, format: 'mp3' }, { ...options, providers: ['speech.primary'] });
  const audio = speechOutputSchema.parse(response.output);
  const file = await saveMedia(context, options.requestKey, Buffer.from(audio.base64, 'base64'), 'mp3', audio.mimeType, input.text, input.folderKey, input.text);
  await announceCompletion(file.key, 'speech', context);
  return { files: [file], durationSeconds: audio.durationSeconds };
}

export async function generateAgentVideo(raw: unknown, context: ToolContext, options: ExecuteActionOptions & { requestKey: string }) {
  const input = agentVideoInputSchema.parse(raw);
  await authorizeOutputFolder(input.folderKey, context);
  const existing = await savedMedia(context, options.requestKey, input.folderKey);
  if (existing) { await announceCompletion(existing.key, 'video', context); return { files: [existing], durationSeconds: input.durationSeconds }; }
  const startFrame = input.startFrameFileKey ? await imageReference(input.startFrameFileKey, context) : undefined;
  const response = await executeAction<unknown, VideoOutput>({ mode: 'auto', teamKey: context.teamKey, actionSlug: 'video' }, { prompt: input.prompt, durationSeconds: input.durationSeconds, aspectRatio: input.aspectRatio, jobKey: createHash('sha256').update(options.requestKey).digest('hex'), ...(startFrame ? { startFrame } : {}) }, { ...options, providers: ['video.primary'], timeoutMs: 10 * 60_000 });
  const video = videoOutputSchema.parse(response.output);
  const file = await saveMedia(context, options.requestKey, video.bytes, 'mp4', video.mimeType, input.prompt, input.folderKey);
  await announceCompletion(file.key, 'video', context);
  return { files: [file], durationSeconds: video.durationSeconds, ...(response.costUsd !== undefined ? { providerCostUsd: response.costUsd } : {}) };
}
