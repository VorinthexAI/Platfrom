import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { getFileInScope, fileExtensionSchema } from '@/lib/db/files.node';
import { getFolderInScope } from '@/lib/db/folders.node';
import { getDefaultConversationRepository } from '@/lib/conversations/repository';
import { conversationMessageSchema, conversationSchema } from '@/lib/conversations/schemas';
import type { AppSearchRetrieval } from '@/lib/app-search/service';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { workshopChatPlans } from './workshop-chats';
import { workshopAudio, workshopDocuments, workshopFolders, workshopImages, workshopStableKey, workshopVideos } from './workshop-year';

export const workshopChatArchivePath = join(import.meta.dir, 'workshop-chat-transcripts.json');
const resultSchema = z.object({ name: z.string().min(1), extension: fileExtensionSchema, label: z.string().min(1) }).strict();
const retrievalSchema = z.object({
  source: z.enum(['results', 'query']), query: z.string().optional(), limit: z.number().int().min(1).max(50),
  inventory: z.object({ folderName: z.string().optional(), extensions: z.array(fileExtensionSchema).min(1).optional() }).strict().optional(),
  results: z.array(resultSchema).max(50),
}).strict();
export const workshopChatArchiveSchema = z.object({
  version: z.literal(1),
  chats: z.array(z.object({ slug: z.string(), title: z.string(), turns: z.array(z.object({ user: z.string().min(1), assistant: z.string().min(1), retrievals: z.array(retrievalSchema).max(4) }).strict()) }).strict()).length(workshopChatPlans.length),
}).strict().superRefine((archive, ctx) => {
  for (const [chatIndex, plan] of workshopChatPlans.entries()) {
    const chat = archive.chats[chatIndex];
    if (chat?.slug !== plan.slug || chat.title !== plan.title || chat.turns.length !== plan.messages.length || chat.turns.some((turn, index) => turn.user !== plan.messages[index])) {
      ctx.addIssue({ code: 'custom', path: ['chats', chatIndex], message: 'Chat transcript does not match the fixture plan.' });
    }
  }
});
export type WorkshopChatArchive = z.infer<typeof workshopChatArchiveSchema>;
export type WorkshopChatRetrieval = WorkshopChatArchive['chats'][number]['turns'][number]['retrievals'][number];

const mediaKey = (userKey: string, name: string) => `c${createHash('sha256').update(`dev:workshop-year-v1:${userKey}:${name}`).digest('hex').slice(0, 24)}`;
const fixtureFiles = (userKey: string, scopeKey: string) => new Map([
  ...workshopDocuments.map(({ name }) => [name.replace(/\.[^.]+$/, ''), workshopStableKey(`${userKey}:${scopeKey}:document:${name}`)] as const),
  ...[...workshopImages, ...workshopAudio, ...workshopVideos].map(({ name }) => [name, mediaKey(userKey, name)] as const),
]);
export const workshopChatKey = (userKey: string, scopeKey: string, slug: string) => workshopStableKey(`${userKey}:${scopeKey}:conversation:${slug}`);

export async function captureWorkshopRetrievals(retrievals: readonly AppSearchRetrieval[], context: ToolContext): Promise<WorkshopChatRetrieval[]> {
  const names = fixtureFiles(context.userKey, context.runtimeScopeKey);
  return Promise.all(retrievals.map(async (retrieval) => {
    const results = await Promise.all(retrieval.groups.flatMap((group) => {
      if (group.collectionSlug !== 'files') throw new Error('Only fixture files may be included in demo chat evidence.');
      return group.results.map(async ({ key, label }) => {
        const file = await getFileInScope(context.runtimeScopeKey, key, context.userKey);
        if (!file || names.get(file.name) !== file.key) throw new Error(`Demo chat evidence does not belong to the Workshop Year fixture: ${label}`);
        return { name: file.name, extension: file.extension, label };
      });
    }));
    const folder = retrieval.inventory?.folderKey ? await getFolderInScope(context.runtimeScopeKey, retrieval.inventory.folderKey, context.userKey) : undefined;
    if (folder && !workshopFolders.some(({ name }) => name === folder.name)) throw new Error('Demo chat inventory belongs to an unrelated folder.');
    return retrievalSchema.parse({ source: retrieval.source, ...(retrieval.query ? { query: retrieval.query } : {}), limit: retrieval.limit,
      ...(retrieval.inventory ? { inventory: { ...(folder ? { folderName: folder.name } : {}), ...(retrieval.inventory.extensions ? { extensions: retrieval.inventory.extensions } : {}) } } : {}), results });
  }));
}

async function restoreRetrievals(retrievals: readonly WorkshopChatRetrieval[], context: ToolContext, names: Map<string, string>): Promise<AppSearchRetrieval[]> {
  return Promise.all(retrievals.map(async (retrieval) => {
    const results = await Promise.all(retrieval.results.map(async (result) => {
      const key = names.get(result.name);
      const file = key ? await getFileInScope(context.runtimeScopeKey, key, context.userKey) : null;
      if (!file || file.extension !== result.extension) throw new Error(`Demo file ${result.name} is missing from this scope.`);
      return { key: file.key, label: result.label };
    }));
    const folderName = retrieval.inventory?.folderName;
    const folderKey = folderName ? workshopStableKey(`${context.userKey}:${context.runtimeScopeKey}:folder:${folderName}`) : undefined;
    if (folderKey && (!workshopFolders.some(({ name }) => name === folderName) || !await getFolderInScope(context.runtimeScopeKey, folderKey, context.userKey))) throw new Error(`Demo folder ${folderName} is unavailable.`);
    return { source: retrieval.source, ...(retrieval.query ? { query: retrieval.query } : {}), limit: retrieval.limit,
      ...(retrieval.inventory ? { inventory: { ...(folderKey ? { folderKey } : {}), ...(retrieval.inventory.extensions ? { extensions: retrieval.inventory.extensions } : {}) } } : {}),
      groups: [{ collectionSlug: 'files' as const, results }] };
  }));
}

export async function seedWorkshopChats(context: ToolContext) {
  const file = Bun.file(workshopChatArchivePath);
  if (!await file.exists()) throw new Error('The checked-in Workshop Year chat transcript is missing. Record it before seeding chats.');
  const archive = workshopChatArchiveSchema.parse(await file.json());
  const repository = getDefaultConversationRepository();
  const owner = { userKey: context.userKey, teamKey: context.teamKey, scopeKey: context.runtimeScopeKey };
  const names = fixtureFiles(context.userKey, context.runtimeScopeKey);
  const at = Date.now() - archive.chats.length * 60 * 60_000;
  for (const [chatIndex, chat] of archive.chats.entries()) {
    const conversationKey = workshopChatKey(context.userKey, context.runtimeScopeKey, chat.slug);
    const startedAt = new Date(at + chatIndex * 60 * 60_000).toISOString();
    let changed = false;
    if (!await repository.read(owner, conversationKey)) {
      await repository.create(conversationSchema.parse({ key: conversationKey, ...owner, name: chat.title, isFavorite: false, isHidden: false, roleKey: 'general', createdAt: startedAt, updatedAt: startedAt }), context.userKey);
      changed = true;
    }
    for (const [index, turn] of chat.turns.entries()) {
      const requestKey = `dev:workshop-chat:${chat.slug}:${index}`;
      const requestHash = createHash('sha256').update(JSON.stringify({ conversationKey, message: turn.user, attachmentKeys: [], referenceImageKeys: [], workspaceFileKeys: [], workspaceFolderKeys: [] })).digest('hex');
      const base = { ...owner, conversationKey, turnKey: requestKey, requestHash, type: 'TEXT' as const, attachments: [], attachmentStatus: 'NONE' as const, retrievals: [], guideTopics: { status: 'NONE' as const } };
      const createdAt = new Date(at + chatIndex * 60 * 60_000 + index * 60_000).toISOString();
      const user = conversationMessageSchema.parse({ ...base, key: workshopStableKey(`${conversationKey}:${index}:user`), role: 'USER', status: 'COMPLETED', content: turn.user, createdAt, completedAt: createdAt });
      const assistant = conversationMessageSchema.parse({ ...base, key: workshopStableKey(`${conversationKey}:${index}:assistant`), role: 'ASSISTANT', status: 'PENDING', content: 'Pending', createdAt: new Date(Date.parse(createdAt) + 1).toISOString() });
      const outcome = await repository.beginTurn(owner, conversationKey, user, assistant, context.userKey);
      if (outcome?.state === 'replay' && outcome.assistant.status === 'COMPLETED') continue;
      if (outcome?.state !== 'created') throw new Error(`Demo chat ${chat.slug} turn ${index + 1} could not be imported (${outcome?.state}).`);
      changed = true;
      const references = await restoreRetrievals(turn.retrievals, context, names);
      const completed = await repository.completeTurn(owner, conversationKey, assistant.key, turn.assistant, undefined, references, new Date(Date.parse(createdAt) + 2).toISOString());
      if (!completed) throw new Error(`Demo chat ${chat.slug} turn ${index + 1} could not be completed.`);
    }
    if (changed) await repository.requestArchiveProjection?.(owner, conversationKey, new Date().toISOString(), context.userKey);
    console.log(`chat ${chat.title}: ${chat.turns.length * 2} messages`);
  }
}
