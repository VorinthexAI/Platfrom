import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const VOICES_COLLECTION = 'voices';

export const voiceSchema = z.object({
  key: z.string(),
  provider: z.string(),
  model: z.string(),
  modelLabel: z.string(),
  voice: z.string(),
  /** Human-facing name — the orchestrator it's mapped to (e.g. "Atlas",
   * "Mercury"), or "Brand Primary" for the launch-asset voiceover default. */
  label: z.string(),
  language: z.string(),
  format: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Voice = z.infer<typeof voiceSchema>;

export const voicesEmbedKeys = z.enum(['voice', 'label', 'modelLabel', 'language']);

const helpers = createNodeHelpers(VOICES_COLLECTION, voiceSchema, voicesEmbedKeys.options);

export const insertVoice = helpers.insert;
export const getVoiceById = helpers.getById;
export const updateVoice = helpers.updateById;
export const deleteVoice = helpers.deleteById;
export const upsertVoiceByKey = helpers.upsertByKey;
export const getAllVoicesChunked = helpers.getAllChunked;
export const listVoicesPage = helpers.listPage;

export async function getVoiceByProviderModelVoice(
  provider: string,
  model: string,
  voice: string,
): Promise<Voice | null> {
  const cursor = await db.query(aql`
    FOR v IN ${db.collection(VOICES_COLLECTION)}
      FILTER v.provider == ${provider} && v.model == ${model} && v.voice == ${voice}
      LIMIT 1
      RETURN v
  `);
  const doc = await cursor.next();
  if (!doc) return null;
  // `label` was added after voices already existed in prod; tolerate it
  // being absent here so upsertSeedVoice's existence check succeeds and its
  // UPDATE patch (which always sets label from seed data) can backfill it.
  return voiceSchema.parse({ label: '', ...withArangoKey(doc) });
}
