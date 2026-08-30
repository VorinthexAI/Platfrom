import { z } from 'zod';
import { speechOutputSchema, type SpeechInput } from '@/lib/ai/actions/speech';
import { documentSemanticHash } from '@/lib/ai/document-processing/chunking';
import { documentStorage, type DocumentStorage } from '@/lib/ai/document-processing/storage';
import { signedAudioUrl } from '@/lib/ai/audio/audio-url';
import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import { contentDocumentAudioVersionSchema } from '@/lib/ai/tools/content-schemas';
import { runContentTool, type ContentRepository, type ContentToolDependencies } from '@/lib/ai/tools/content-runtime';
import { ContentError } from '@/lib/ai/tools/content-errors';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import type { Document } from '@/lib/db/documents.node';
import type { DocumentAudioVersion } from '@/lib/db/document-audio-versions.node';
import { newId } from '@/lib/ids';

const key = z.string().cuid();
export const appSpeechVoiceSchema = z.enum(['calm', 'clear', 'warm']);
export const appSpeechInputSchema = z.object({
  documentKey: key,
  voice: appSpeechVoiceSchema.default('clear'),
  pace: z.number().finite().min(0.75).max(2).default(1),
  includeTitle: z.boolean().default(true),
  includeCode: z.boolean().default(false),
}).strict();

const trustedTargetInputSchema = z.object({
  organizationKey: z.string().trim().min(1),
  storageKey: z.string().trim().min(1),
  text: z.string().trim().min(1).max(50_000),
  language: z.string().trim().min(2).max(100).default('English'),
  voice: appSpeechVoiceSchema,
  pace: z.number().finite().min(0.75).max(2),
}).strict();

export type AppSpeechVoice = z.infer<typeof appSpeechVoiceSchema>;
export type AppSpeechDocumentVersion = z.infer<typeof contentDocumentAudioVersionSchema>;

export interface AppSpeechTargetOptions<T> extends ExecuteActionOptions {
  afterSpeech?: () => Promise<void>;
  persist: (audio: { storageKey: string; mimeType: 'audio/mpeg'; sizeBytes: number; durationMs: number; durationSeconds: number; voice: AppSpeechVoice; speakingRate: number }) => Promise<T>;
  compensate?: (storageKey: string) => Promise<void>;
}

export interface AppSpeechService {
  generateDocument(input: z.input<typeof appSpeechInputSchema>, context: ToolContext, options?: ExecuteActionOptions): Promise<AppSpeechDocumentVersion>;
  generateForTarget<T>(input: z.input<typeof trustedTargetInputSchema>, options: AppSpeechTargetOptions<T>): Promise<{ target: T; storageKey: string; durationSeconds: number }>;
}

interface AppSpeechDependencies {
  repository?: Pick<ContentRepository, 'getDocument' | 'createAudioVersion'>;
  content?: ContentToolDependencies;
  executeContent?: typeof runContentTool;
  storage?: DocumentStorage;
  speech?: (input: SpeechInput, organizationKey: string, options?: ExecuteActionOptions) => Promise<{ bytes: Uint8Array; mimeType: 'audio/mpeg'; durationSeconds?: number }>;
  signAudioUrl?: (storageKey: string) => Promise<string>;
  id?: () => string;
  now?: () => string;
  publishChanged?: (scopeKey: string) => Promise<unknown>;
}

const voiceMap: Record<AppSpeechVoice, SpeechInput['voice']> = { calm: 'sage', clear: 'alloy', warm: 'coral' };
export const APP_SPEECH_WORDS_PER_MINUTE = 162;
const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const fallbackDurationSeconds = (text: string, pace: number) => Math.max(1, Math.ceil(words(text) / (APP_SPEECH_WORDS_PER_MINUTE / 60 * pace)));

function member(context: ToolContext) {
  if (context.principal.kind !== 'member') throw new ContentError('CONTENT_UNAUTHORIZED', 'A resolved human principal is required.', 'app.speech', { action: 'authorization' });
  const principal = context.principal;
  if (principal.userOrganization.organizationId !== context.organizationKey || principal.userOrganization.userId !== principal.user.key || principal.userOrganization.status !== 'active') {
    throw new ContentError('CONTENT_FORBIDDEN', 'Active matching organization membership is required.', 'app.speech', { action: 'authorization' });
  }
  return principal;
}

function narrationText(document: Pick<Document, 'name' | 'content'>, input: z.output<typeof appSpeechInputSchema>) {
  const content = input.includeCode ? document.content : document.content.replace(/```[\s\S]*?```/g, '').trim();
  return [input.includeTitle ? document.name : '', content].filter(Boolean).join('.\n\n').trim();
}

async function productionRepository(): Promise<Pick<ContentRepository, 'getDocument' | 'createAudioVersion'>> {
  const { contentPersistence } = await import('@/lib/db/content-persistence.node');
  return { getDocument: contentPersistence.getDocument, createAudioVersion: contentPersistence.createAudioVersion };
}

export function createAppSpeechService(dependencies: AppSpeechDependencies = {}): AppSpeechService {
  const storage = dependencies.storage ?? documentStorage;
  const speech = dependencies.speech ?? (async (input, organizationKey, options) => {
    const output = speechOutputSchema.parse((await executeAction({ mode: 'auto', organizationKey, actionSlug: 'speech' }, input, { providers: ['speech.primary'], ...options })).output);
    return { bytes: Buffer.from(output.base64, 'base64'), mimeType: output.mimeType, durationSeconds: output.durationSeconds };
  });
  const generateForTarget: AppSpeechService['generateForTarget'] = async (rawInput, options) => {
    const input = trustedTargetInputSchema.parse(rawInput);
    const { afterSpeech, persist, compensate, ...actionOptions } = options;
    const generated = await speech({ text: input.text, language: input.language, voice: voiceMap[input.voice], pace: input.pace, format: 'mp3' }, input.organizationKey, actionOptions);
    await afterSpeech?.();
    const durationSeconds = generated.durationSeconds ?? fallbackDurationSeconds(input.text, input.pace);
    const stored = await storage.upload({ key: input.storageKey, bytes: generated.bytes, mimeType: generated.mimeType });
    try {
      const target = await persist({ storageKey: stored.storageKey, mimeType: generated.mimeType, sizeBytes: generated.bytes.byteLength, durationMs: durationSeconds * 1_000, durationSeconds, voice: input.voice, speakingRate: input.pace });
      return { target, storageKey: stored.storageKey, durationSeconds };
    } catch (error) {
      try { await (compensate ?? storage.delete.bind(storage))(stored.storageKey); } catch { /* The persistence error remains the authoritative failure. */ }
      throw error;
    }
  };

  return {
    generateForTarget,
    async generateDocument(rawInput, context, options) {
      const input = appSpeechInputSchema.parse(rawInput);
      const principal = member(context);
      const executeContent = dependencies.executeContent ?? runContentTool;
      const found = await executeContent('document.find', { documentKeys: [input.documentKey], include: ['content'] }, context, dependencies.content) as any;
      const projected = found.results?.[0];
      if (!projected?.success || !projected.data?.document) throw new ContentError('CONTENT_NOT_FOUND', 'Document was not found.', 'app.speech', { action: 'read', resourceKey: input.documentKey });
      const repository = dependencies.repository ?? await productionRepository();
      const document = await repository.getDocument(input.documentKey);
      if (!document || document.scopeKey !== context.runtimeScopeKey || document.scopeKey !== projected.data.document.scopeKey || document._internalDeletion || document.archiveVisibility === 'domain-only') {
        throw new ContentError('CONTENT_NOT_FOUND', 'Document was not found in the active Archive scope.', 'app.speech', { action: 'resolution', resourceKey: input.documentKey });
      }
      if (document.mutationPolicy === 'system-only' || document.managedPurpose) throw new ContentError('CONTENT_FORBIDDEN', 'Managed documents are read-only.', 'app.speech', { action: 'persist', resourceKey: input.documentKey });
      if (!repository.createAudioVersion) throw new ContentError('CONTENT_CONFLICT', 'Document audio persistence is unavailable.', 'app.speech', { action: 'persist', resourceKey: input.documentKey });
      const text = narrationText(document, input);
      if (!text) throw new ContentError('CONTENT_INVALID_INPUT', 'Document narration is empty.', 'app.speech', { action: 'speech', resourceKey: input.documentKey });
      const timestamp = dependencies.now?.() ?? new Date().toISOString();
      const audioKey = dependencies.id?.() ?? newId();
      const generated = await generateForTarget({ organizationKey: context.organizationKey, storageKey: `document-audio/${document.scopeKey}/${document.key}/${audioKey}.mp3`, text, voice: input.voice, pace: input.pace }, {
        ...options,
        persist: (audio) => repository.createAudioVersion!({
          key: audioKey, scopeKey: document.scopeKey, documentKey: document.key, sourceContentHash: documentSemanticHash(document.content), sourceTitle: document.name,
          sourceDocumentUpdatedAt: document.updatedAt, storageKey: audio.storageKey, mimeType: audio.mimeType, sizeBytes: audio.sizeBytes, durationMs: audio.durationMs,
          voice: input.voice, speakingRate: input.pace, includeTitle: input.includeTitle, includeCode: input.includeCode, createdByKey: principal.user.key, createdAt: timestamp,
        }),
      });
      const version = generated.target as DocumentAudioVersion;
      const publishChanged = dependencies.publishChanged ?? (async (scopeKey: string) => (await import('@/api/events')).publishScopeEvent(scopeKey, 'content.changed'));
      await publishChanged(document.scopeKey).catch(() => undefined);
      const { storageKey: _storageKey, createdByKey: _createdByKey, scopeKey: _scopeKey, ...safe } = version;
      return contentDocumentAudioVersionSchema.parse({ ...safe, current: version.sourceContentHash === documentSemanticHash(document.content) && (!version.includeTitle || version.sourceTitle === document.name), url: await (dependencies.signAudioUrl ?? signedAudioUrl)(version.storageKey) });
    },
  };
}
