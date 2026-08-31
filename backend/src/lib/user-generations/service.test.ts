import { expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createUserGenerationService } from './service';

test('generation history normalizes prompts and returns private projections', async () => {
  const rows: any[] = [];
  const service = createUserGenerationService({ repository: { async record(value) { rows.push(value); return value; }, async list() { return rows; }, async remove(_userKey, _type, normalizedPrompt) { return normalizedPrompt === 'a globe'; } }, id: newId, now: () => '2026-08-31T00:00:00.000Z' });
  const userKey = newId();
  const recorded = await service.record(userKey, 'image', '  A   Globe  ');
  expect(recorded).toEqual({ type: 'image', prompt: 'A   Globe', normalizedPrompt: 'a globe', usageCount: 1, generatedAt: '2026-08-31T00:00:00.000Z' });
  expect(JSON.stringify(recorded)).not.toContain(userKey);
  expect(await service.remove(userKey, 'image', 'A GLOBE')).toEqual({ normalizedPrompt: 'a globe', deleted: true });
});
