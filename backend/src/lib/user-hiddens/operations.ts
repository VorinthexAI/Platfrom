import { createUserHiddenService, type UserHiddenService } from './service';
import type { UserHiddenActor } from './repository';
import type { UserHiddenSource } from '@/lib/db/user-hiddens.node';

export interface UserHiddenOperationContext extends UserHiddenActor { service?: UserHiddenService }
export const userHiddenOperations = {
  list: (_input: Record<string, never>, context: UserHiddenOperationContext) => (context.service ?? createUserHiddenService()).list(context),
  hide: (input: { source: UserHiddenSource; sourceKey: string }, context: UserHiddenOperationContext) => (context.service ?? createUserHiddenService()).hide(context, input),
  reveal: (input: { source: UserHiddenSource; sourceKey: string }, context: UserHiddenOperationContext) => (context.service ?? createUserHiddenService()).reveal(context, input),
};
