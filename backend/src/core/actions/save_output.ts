import { z } from 'zod';
import { insertOutput, incrementOutputUsageCount } from '@/lib/db/outputs.node';
import { insertOutputRelation } from '@/lib/db/output-relations.node';
import { newId } from '@/lib/ids';
import { nowIso } from './action-utils';

export const saveOutputInputSchema = z.object({
  type: z.string(),
  data: z.unknown().optional(),
  storage_path: z.string().optional(),
  relation: z.object({
    parent_output_id: z.string(),
    relation_type: z.string(),
  }).optional(),
});

export async function save_output(input: z.infer<typeof saveOutputInputSchema>) {
  const parsed = saveOutputInputSchema.parse(input);
  const outputId = newId();
  await insertOutput({
    key: outputId,
    type: parsed.type,
    data: (parsed.data as Record<string, unknown> | null | undefined) ?? null,
    storagePath: parsed.storage_path ?? null,
    createdAt: nowIso(),
  });
  if (parsed.relation) {
    await insertOutputRelation({
      key: newId(),
      parentOutputId: parsed.relation.parent_output_id,
      childOutputId: outputId,
      relationType: parsed.relation.relation_type,
      createdAt: nowIso(),
    });
    await incrementOutputUsageCount(parsed.relation.parent_output_id);
  }
  return { id: outputId };
}
