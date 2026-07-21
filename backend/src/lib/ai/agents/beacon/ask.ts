import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import type { Organization } from '@/lib/db/organizations.node';
import type { User } from '@/lib/db/users.node';
import type { UserOrganization } from '@/lib/db/user-organization.node';
import type { Scope } from '@/lib/ai/scopes';

export const BEACON_ASK_MAX_MESSAGE_LENGTH = 20_000;
export const BEACON_NO_DELEGATE_MESSAGE = 'No eligible specialist agent is available for this request.';
export const beaconAskMessageSchema = z.string().trim().min(1).max(BEACON_ASK_MAX_MESSAGE_LENGTH);

export class BeaconAskRequestError extends AiError {
  constructor(detail: string) { super('beacon_ask_invalid', `Invalid Beacon ask: ${detail}`); }
}

export interface BeaconAskParams {
  organization: Organization;
  scope: Scope;
  membership: UserOrganization;
  user: User;
  message: string;
}

export interface BeaconAskOptions {
  signal?: AbortSignal;
}

export type BeaconAskEvent =
  | { type: 'started'; runKey: string }
  | { type: 'delta'; text: string }
  | { type: 'completed'; runKey: string };

function assertRequest(params: BeaconAskParams) {
  const { organization, scope, membership, user } = params;
  if (!organization.isActive) throw new BeaconAskRequestError('organization is archived');
  if (scope.deletedAt !== null) throw new BeaconAskRequestError('scope is archived');
  if (membership.status !== 'active') throw new BeaconAskRequestError('membership is not active');
  if (membership.userId !== user.key) throw new BeaconAskRequestError('membership does not belong to the user');
  if (membership.organizationId !== organization.key) throw new BeaconAskRequestError('membership belongs to another organization');
  if (scope.organizationKey !== organization.key) throw new BeaconAskRequestError('scope belongs to another organization');
}

/** Beacon has no installed specialists until one is explicitly provisioned. */
export async function* streamFoundersBeaconAsk(params: BeaconAskParams, options: BeaconAskOptions = {}): AsyncGenerator<BeaconAskEvent> {
  beaconAskMessageSchema.parse(params.message);
  assertRequest(params);
  options.signal?.throwIfAborted();
  const runKey = crypto.randomUUID();
  yield { type: 'started', runKey };
  yield { type: 'delta', text: BEACON_NO_DELEGATE_MESSAGE };
  yield { type: 'completed', runKey };
}
