import { userSettingsSchema } from '@/lib/db/users.node';
import { createUserSettingsRepository, type UserSettingsRepository } from './repository';

export class UserSettingsNotFoundError extends Error {}

export function createUserSettingsService(options: {
  repository?: UserSettingsRepository;
  now?: () => string;
} = {}) {
  const repository = options.repository ?? createUserSettingsRepository();
  const now = options.now ?? (() => new Date().toISOString());
  return {
    async read(userKey: string) {
      const settings = await repository.read(userKey);
      if (!settings) throw new UserSettingsNotFoundError('User settings were not found.');
      return userSettingsSchema.parse(settings);
    },
    async update(userKey: string, input: unknown) {
      const settings = userSettingsSchema.parse(input);
      const updated = await repository.update(userKey, settings, now());
      if (!updated) throw new UserSettingsNotFoundError('User settings were not found.');
      return userSettingsSchema.parse(updated);
    },
  };
}

export type UserSettingsService = ReturnType<typeof createUserSettingsService>;
