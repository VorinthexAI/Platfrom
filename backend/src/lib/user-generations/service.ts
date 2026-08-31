import { newId } from '@/lib/ids';
import { getDefaultUserGenerationRepository, type UserGenerationRepository, userGenerationTypeSchema } from './repository';
import type { z } from 'zod';

export type UserGenerationType = z.infer<typeof userGenerationTypeSchema>;
export function normalizeGenerationPrompt(prompt: string) { return prompt.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }

export interface UserGenerationService {
  record(userKey: string, type: UserGenerationType, prompt: string): Promise<GenerationHistoryItem>;
  list(userKey: string, type: UserGenerationType, limit?: number): Promise<GenerationHistoryItem[]>;
  remove(userKey: string, type: UserGenerationType, prompt: string): Promise<{ normalizedPrompt: string; deleted: boolean }>;
}
export interface GenerationHistoryItem { type: UserGenerationType; prompt: string; normalizedPrompt: string; usageCount: number; generatedAt: string; }

export function createUserGenerationService(options: { repository?: UserGenerationRepository; id?: () => string; now?: () => string } = {}): UserGenerationService {
  const repository = options.repository ?? getDefaultUserGenerationRepository();
  const id = options.id ?? newId;
  const now = options.now ?? (() => new Date().toISOString());
  const project = ({ key: _key, userKey: _userKey, ...item }: Awaited<ReturnType<UserGenerationRepository['record']>>) => item;
  return {
    async record(userKey, type, prompt) { return project(await repository.record({ key: id(), userKey, type, prompt: prompt.trim(), normalizedPrompt: normalizeGenerationPrompt(prompt), usageCount: 1, generatedAt: now() })); },
    async list(userKey, type, limit = 20) { return (await repository.list(userKey, type, limit)).map(project); },
    async remove(userKey, type, prompt) { const normalizedPrompt = normalizeGenerationPrompt(prompt); return { normalizedPrompt, deleted: await repository.remove(userKey, type, normalizedPrompt) }; },
  };
}

let defaultService: UserGenerationService | undefined;
export function getDefaultUserGenerationService() { return defaultService ??= createUserGenerationService(); }
