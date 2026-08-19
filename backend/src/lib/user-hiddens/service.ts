import { newId } from '@/lib/ids';
import { userHiddenSourceSchema, type UserHiddenSource } from '@/lib/db/user-hiddens.node';
import { createUserHiddenRepository, type UserHiddenActor, type UserHiddenRepository } from './repository';

export class UserHiddenSourceNotFoundError extends Error {}

export interface UserHiddenService {
  list(actor: UserHiddenActor): ReturnType<UserHiddenRepository['list']>;
  hide(actor: UserHiddenActor, input: { source: UserHiddenSource; sourceKey: string }): ReturnType<UserHiddenRepository['hide']>;
  reveal(actor: UserHiddenActor, input: { source: UserHiddenSource; sourceKey: string }): ReturnType<UserHiddenRepository['reveal']>;
}

export function createUserHiddenService(repository: UserHiddenRepository = createUserHiddenRepository(), now = () => new Date().toISOString()): UserHiddenService {
  const validateAccess = async (actor: UserHiddenActor, source: UserHiddenSource, sourceKey: string) => {
    if (!await repository.canAccess(actor, source, sourceKey)) throw new UserHiddenSourceNotFoundError('Source was not found.');
  };
  return {
    list: (actor) => repository.list(actor),
    async hide(actor, input) {
      const source = userHiddenSourceSchema.parse(input.source);
      await validateAccess(actor, source, input.sourceKey);
      return repository.hide({ key: newId(), userKey: actor.userKey, source, sourceKey: input.sourceKey, createdAt: now() });
    },
    async reveal(actor, input) {
      const source = userHiddenSourceSchema.parse(input.source);
      await validateAccess(actor, source, input.sourceKey);
      return repository.reveal(actor.userKey, source, input.sourceKey);
    },
  };
}
