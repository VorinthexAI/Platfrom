import { getUserById, updateUserSettings, type UserSettings } from '@/lib/db/users.node';

export interface UserSettingsRepository {
  read(userKey: string): Promise<UserSettings | null>;
  update(userKey: string, settings: UserSettings, updatedAt: string): Promise<UserSettings | null>;
}

export function createUserSettingsRepository(options: {
  getUser?: typeof getUserById;
  updateSettings?: typeof updateUserSettings;
} = {}): UserSettingsRepository {
  const readUser = options.getUser ?? getUserById;
  const writeSettings = options.updateSettings ?? updateUserSettings;
  return {
    async read(userKey) {
      return (await readUser(userKey))?.settings ?? null;
    },
    async update(userKey, settings, updatedAt) {
      return (await writeSettings(userKey, settings, updatedAt))?.settings ?? null;
    },
  };
}
