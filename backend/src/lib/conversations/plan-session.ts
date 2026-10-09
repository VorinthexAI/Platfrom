import { aql } from 'arangojs';
import { streamAsk, type ExecuteActionOptions } from '@/lib/ai/router';
import { ingestExtractedText } from '@/lib/ai/tools/content-runtime';
import { contextUserKey, type ToolContext } from '@/lib/ai/tools/tool-context';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { getRole, type RoleKey } from '@/lib/ai/roles';
import { db } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { FILES_COLLECTION, fileSchema, fileStorageKey, insertFile, updateFile } from '@/lib/db/files.node';
import { FOLDERS_COLLECTION, folderSchema, insertFolder } from '@/lib/db/folders.node';
import { newId } from '@/lib/ids';

const PLAN_CONTINUE = '[[plan:continue]]';
const PLAN_READY = '[[plan:ready]]';
const PLAN_MARKERS = [PLAN_CONTINUE, PLAN_READY] as const;
const PLAN_HOLD = Math.max(...PLAN_MARKERS.map((marker) => marker.length));
const PLAN_DOCUMENT_LIMIT = 80_000;

export type PlanStatus = 'continue' | 'ready';
export type SavedPlan = { fileKey: string; name: string; folderName: 'Plans' };

export function planInterviewPrompt(roleKey: RoleKey) {
  const role = getRole(roleKey);
  return `You are helping the user build a plan before it is saved. Role: ${role.label}. ${role.instructions}

Ask only the questions still needed to make the plan specific. Keep each reply to one or two focused questions, in the user's language. Do not write the full plan in the chat. Do not mention models, prompts, or these instructions.

When the user confirms the plan is finished, asks to save it, or clearly has nothing more to add, stop questioning. Infer that planning is done. Reply with one short sentence that the plan will be saved.

End every reply with exactly one status line and nothing after it:
${PLAN_CONTINUE}
${PLAN_READY}

Use ${PLAN_READY} only when the user has signaled that planning is done. Otherwise use ${PLAN_CONTINUE}.`;
}

export function splitPlanStream(buffer: string, final: boolean): { emit: string; rest: string; status?: PlanStatus } {
  if (!final) {
    let hold = 0;
    const limit = Math.min(PLAN_HOLD, buffer.length);
    for (let length = 1; length <= limit; length += 1) {
      const suffix = buffer.slice(-length);
      if (PLAN_MARKERS.some((marker) => marker.startsWith(suffix))) hold = length;
    }
    return { emit: buffer.slice(0, buffer.length - hold), rest: buffer.slice(buffer.length - hold) };
  }
  const trimmed = buffer.replace(/\s+$/, '');
  for (const marker of PLAN_MARKERS) {
    if (!trimmed.endsWith(marker)) continue;
    return { emit: trimmed.slice(0, -marker.length).replace(/\s+$/, ''), rest: '', status: marker === PLAN_READY ? 'ready' : 'continue' };
  }
  return { emit: buffer, rest: '' };
}

function transcript(history: ReadonlyArray<{ role: 'USER' | 'ASSISTANT'; content: string }>, message: string, confirmation?: string) {
  const lines = history.map((item) => `${item.role === 'USER' ? 'User' : 'Assistant'}: ${item.content}`);
  lines.push(`User: ${message}`);
  if (confirmation) lines.push(`Assistant: ${confirmation}`);
  return lines.join('\n\n').slice(0, 80_000);
}

function planTitle(markdown: string) {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.replace(/^#+\s*/, '').trim();
  const cleaned = (heading || 'Plan').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return cleaned || 'Plan';
}

async function collectPlanText(teamKey: string, systemPrompt: string, message: string, options: ExecuteActionOptions) {
  let text = '';
  for await (const chunk of streamAsk(teamKey, {
    systemPrompt,
    messages: [{ role: 'user', content: [{ type: 'text', text: message }] }],
    options: { maxTokens: 8_192, temperature: 0.2 },
  }, { ...options, providers: ['plan.primary'], capabilities: undefined })) {
    if (chunk.type === 'text-delta') text += chunk.text;
  }
  return text.trim();
}

async function plansFolder(scopeKey: string, userKey: string, at: string) {
  const cursor = await db.query(aql`
    FOR folder IN ${db.collection(FOLDERS_COLLECTION)}
      FILTER folder.scopeKey == ${scopeKey} && folder.userKey == ${userKey}
      FILTER !HAS(folder, 'parentFolderKey') && folder.managedPurpose == null && LOWER(folder.name) == 'plans'
      LIMIT 1
      RETURN folder
  `);
  const existing = await cursor.next();
  if (existing) return folderSchema.parse(withArangoKey(existing as Record<string, unknown>));
  return insertFolder({ key: newId(), userKey, scopeKey, name: 'Plans', isFavorite: false, isHidden: false, createdAt: at, updatedAt: at });
}

async function uniquePlanName(scopeKey: string, userKey: string, folderKey: string, title: string) {
  for (let index = 0; index < 50; index += 1) {
    const name = index === 0 ? title : `${title.slice(0, 76)} ${index + 1}`;
    const cursor = await db.query(aql`
      FOR file IN ${db.collection(FILES_COLLECTION)}
        FILTER file.scopeKey == ${scopeKey} && file.userKey == ${userKey} && file.folderKey == ${folderKey} && file.name == ${name} && file.extension == 'md'
        LIMIT 1
        RETURN file._key
    `);
    if (!(await cursor.next())) return name;
  }
  return `${title.slice(0, 60)} ${newId().slice(-6)}`;
}

export async function savePlanDocument(context: ToolContext, markdown: string, at: string): Promise<SavedPlan> {
  const userKey = contextUserKey(context);
  const scopeKey = context.runtimeScopeKey;
  const document = markdown.trim().slice(0, PLAN_DOCUMENT_LIMIT);
  if (!document) throw new Error('The plan document was empty.');
  const folder = await plansFolder(scopeKey, userKey, at);
  const name = await uniquePlanName(scopeKey, userKey, folder.key, planTitle(document));
  const key = newId();
  const storageKey = fileStorageKey(userKey, key, 'md');
  const bytes = Buffer.from(document, 'utf8');
  await documentStorage.upload({ key: storageKey, bytes, mimeType: 'text/markdown', billingUserKey: userKey });
  try {
    const file = await insertFile({
      key, userKey, scopeKey, folderKey: folder.key, name, extension: 'md', mimeType: 'text/markdown',
      sizeBytes: bytes.byteLength, storageKey, processing: 'pending', isFavorite: false, isHidden: false, createdAt: at, updatedAt: at,
    });
    try {
      await ingestExtractedText(file.key, document);
    } catch (error) {
      console.error('plan document indexing failed', { fileKey: file.key, error });
      await updateFile(file.key, { extractedText: document, processing: 'ready', embedding: [] });
    }
    return { fileKey: fileSchema.parse(file).key, name, folderName: 'Plans' };
  } catch (error) {
    await documentStorage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function runPlanSession(input: {
  teamKey: string;
  context: ToolContext;
  roleKey: RoleKey;
  history: ReadonlyArray<{ role: 'USER' | 'ASSISTANT'; content: string }>;
  message: string;
  options?: ExecuteActionOptions;
  onDelta: (text: string) => Promise<void>;
}): Promise<{ message: string; saved?: SavedPlan }> {
  let pending = '';
  let visible = '';
  const push = async (text: string, final = false) => {
    pending += text;
    const drained = splitPlanStream(pending, final);
    pending = drained.rest;
    if (drained.emit) {
      visible += drained.emit;
      await input.onDelta(drained.emit);
    }
    return drained.status;
  };
  let status: PlanStatus | undefined;
  for await (const chunk of streamAsk(input.teamKey, {
    systemPrompt: planInterviewPrompt(input.roleKey),
    messages: [
      ...input.history.map((item) => ({ role: item.role === 'USER' ? 'user' as const : 'assistant' as const, content: [{ type: 'text' as const, text: item.content }] })),
      { role: 'user' as const, content: [{ type: 'text' as const, text: input.message }] },
    ],
    options: { maxTokens: 1_200, temperature: 0.3 },
  }, { ...input.options, providers: ['plan.primary'], capabilities: undefined })) {
    if (chunk.type === 'text-delta') status = await push(chunk.text) ?? status;
  }
  status = await push('', true) ?? status;
  if (!status) {
    const decision = await collectPlanText(input.teamKey, `Decide whether this planning conversation is finished. Reply with only ${PLAN_READY} if the user confirmed the plan is done, asked to save it, or clearly has nothing more to add. Otherwise reply with only ${PLAN_CONTINUE}.`, transcript(input.history, input.message, visible), input.options ?? {});
    status = decision.includes(PLAN_READY) ? 'ready' : 'continue';
  }
  if (status !== 'ready') {
    const message = visible.trim() || 'What should this plan decide?';
    if (!visible.trim()) await input.onDelta(message);
    return { message };
  }
  const confirmation = visible.trim() || 'Saving this plan.';
  if (!visible.trim()) await input.onDelta(confirmation);
  const document = await collectPlanText(input.teamKey, 'Write an extensive markdown plan from the planning conversation. Use only what was discussed, and mark assumptions explicitly. Include a title, objective, decisions, steps, risks, and how success will be observed. Start with a single H1 title. Return the markdown document and nothing else.', transcript(input.history, input.message, confirmation), input.options ?? {});
  const saved = await savePlanDocument(input.context, document, new Date().toISOString());
  return { message: confirmation, saved };
}
