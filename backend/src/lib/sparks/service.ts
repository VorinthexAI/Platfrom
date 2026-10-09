import { calculateByteHours, calculateFixedCost, HOURS_PER_BILLING_MONTH, lookupCostRule, storageCostMicroSparks, storageCostMicroSparksExact } from '@/lib/costs';
import { z } from 'zod';
import { getDefaultStorageChargingRepository } from '@/lib/automations/storage-charger-repository';
import { activePrivateAgentHasUnlimitedSparks } from '@/lib/apps/private-access';
import { getUserById } from '@/lib/db/users.node';
import { sparkHistoryInputSchema, sparkMetadataSchema, sparkTransactionSchema, type SparkHistoryInput, type SparkMetadata, type SparkTransaction, type SparkTransactionKind } from './contracts';
import type { ApplySparkResult, SparkRepository } from './repository';
import { createArangoSparkRepository, SparkRepositoryError } from './repository';
import { newId } from '@/lib/ids';
import { publishUserEvent } from '@/api/events';

type OperationIdentity = Readonly<{ idempotencyKey: string; requestHash: string; eventKey?: string; metadata?: SparkMetadata }>;
type ChargeInput = OperationIdentity & Readonly<{ microSparks: number }>;
type RefundInput = Omit<ChargeInput, 'metadata'> & Readonly<{ chargeTransactionKey: string; executionIdentity?: string }>;
type InvocationInput = OperationIdentity & Readonly<{ toolSlug?: string; actionSlug?: string }>;

export interface SparkServiceDependencies {
  repository: SparkRepository;
  createKey?: () => string;
  now?: () => Date;
  getActiveStoredBytes?: (userKey: string) => Promise<string>;
  getActiveStoredBytesForScope?: (userKey: string, scopeKey: string) => Promise<string>;
  publishBalance?: typeof publishUserEvent;
  isUnlimited?: (userKey: string) => Promise<boolean>;
}

function positiveSafeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('microSparks must be a positive safe integer.');
  return value;
}

async function privateAgentUnlimited(userKey: string) {
  const user = await getUserById(userKey);
  return activePrivateAgentHasUnlimitedSparks(user);
}

function waivedCharge(userKey: string, kind: SparkTransactionKind, input: OperationIdentity & Readonly<{ toolSlug?: string; actionSlug?: string }>, at: string): ApplySparkResult {
  return {
    status: 'replayed',
    transaction: sparkTransactionSchema.parse({
      key: input.idempotencyKey,
      userKey,
      kind,
      deltaMicroSparks: -1,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      ...(input.eventKey ? { eventKey: input.eventKey } : {}),
      ...(input.toolSlug ? { toolSlug: input.toolSlug } : {}),
      ...(input.actionSlug ? { actionSlug: input.actionSlug } : {}),
      metadata: { unlimited: true },
      balanceAfterMicroSparks: 0,
      createdAt: at,
    }),
  };
}

export function createSparkService({ repository, createKey = newId, now = () => new Date(), getActiveStoredBytes = async () => '0', getActiveStoredBytesForScope, publishBalance = async () => {}, isUnlimited = privateAgentUnlimited }: SparkServiceDependencies) {
  const publish = (userKey: string) => { void publishBalance(userKey, 'spark.balance.changed').catch(() => undefined); };
  const apply = async (
    trustedUserKey: string,
    kind: SparkTransactionKind,
    deltaMicroSparks: number,
    input: OperationIdentity & Readonly<{ toolSlug?: string; actionSlug?: string }>,
  ) => {
    const result = await repository.apply({
      key: createKey(),
      userKey: trustedUserKey,
      kind,
      deltaMicroSparks,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      ...(input.eventKey ? { eventKey: input.eventKey } : {}),
      ...(input.toolSlug ? { toolSlug: input.toolSlug } : {}),
      ...(input.actionSlug ? { actionSlug: input.actionSlug } : {}),
      ...(input.metadata ? { metadata: sparkMetadataSchema.parse(input.metadata) } : {}),
      createdAt: now().toISOString(),
    });
    if (result.status === 'applied' || result.status === 'replayed') publish(trustedUserKey);
    return result;
  };

  return Object.freeze({
    async charge(trustedUserKey: string, input: ChargeInput & Readonly<{ kind: 'tool' | 'action' | 'storage'; toolSlug?: string; actionSlug?: string }>) {
      if (await isUnlimited(trustedUserKey)) return waivedCharge(trustedUserKey, input.kind, input, now().toISOString());
      return apply(trustedUserKey, input.kind, -positiveSafeInteger(input.microSparks), input);
    },
    async chargeExecution(trustedUserKey: string, input: ChargeInput & Readonly<{ kind: 'tool' | 'action'; toolSlug?: string; actionSlug?: string; executionIdentity: string }>) {
      if (await isUnlimited(trustedUserKey)) return waivedCharge(trustedUserKey, input.kind, input, now().toISOString());
      const { executionIdentity, ...charge } = input;
      const record = {
        key: createKey(), userKey: trustedUserKey, kind: charge.kind, deltaMicroSparks: -positiveSafeInteger(charge.microSparks),
        idempotencyKey: charge.idempotencyKey, requestHash: charge.requestHash, createdAt: now().toISOString(),
        ...(charge.eventKey ? { eventKey: charge.eventKey } : {}), ...(charge.toolSlug ? { toolSlug: charge.toolSlug } : {}),
        ...(charge.actionSlug ? { actionSlug: charge.actionSlug } : {}),
        ...(charge.metadata ? { metadata: sparkMetadataSchema.parse(charge.metadata) } : {}),
      } satisfies Parameters<SparkRepository['apply']>[0];
      const claimedAt = now();
      const owner = createKey();
      const result = await (repository.applyExecutionCharge ? repository.applyExecutionCharge(record, executionIdentity, { owner, now: claimedAt.toISOString(), expiresAt: new Date(claimedAt.getTime() + 5 * 60_000).toISOString() }) : repository.apply(record));
      if (result.status === 'applied' || result.status === 'replayed') publish(trustedUserKey);
      return result;
    },
    async completeExecution(trustedUserKey: string, executionIdentity: string, owner: string) {
      if (!repository.completeExecution) return true;
      return repository.completeExecution(trustedUserKey, executionIdentity, owner, now().toISOString());
    },
    async renewExecution(trustedUserKey: string, executionIdentity: string, owner: string) {
      if (!repository.renewExecution) return true;
      const renewedAt = now();
      return repository.renewExecution(trustedUserKey, executionIdentity, owner, renewedAt.toISOString(), new Date(renewedAt.getTime() + 5 * 60_000).toISOString());
    },
    refund(trustedUserKey: string, input: RefundInput) {
      const { chargeTransactionKey, executionIdentity, ...identity } = input;
      return apply(trustedUserKey, 'refund', positiveSafeInteger(input.microSparks), {
        ...identity, metadata: { refundOfTransactionKey: chargeTransactionKey, ...(executionIdentity ? { executionIdentity } : {}) },
      });
    },
    adjust(trustedUserKey: string, input: OperationIdentity & Readonly<{ deltaMicroSparks: number }>) {
      if (!Number.isSafeInteger(input.deltaMicroSparks) || input.deltaMicroSparks === 0) throw new RangeError('deltaMicroSparks must be a nonzero safe integer.');
      return apply(trustedUserKey, 'adjustment', input.deltaMicroSparks, input);
    },
    async chargeInvocation(trustedUserKey: string, input: InvocationInput): Promise<ApplySparkResult | null> {
      const resolved = lookupCostRule(input);
      if (!resolved || await isUnlimited(trustedUserKey)) return null;
      return apply(trustedUserKey, resolved.source, -calculateFixedCost(resolved.rule), {
        ...input,
        ...(resolved.source === 'tool' ? { toolSlug: resolved.slug } : { actionSlug: resolved.slug }),
      });
    },
    async chargeStorage(trustedUserKey: string, input: OperationIdentity & Readonly<{ byteHours: number | bigint }>): Promise<ApplySparkResult | null> {
      const microSparks = storageCostMicroSparks(input.byteHours);
      if (microSparks === 0 || await isUnlimited(trustedUserKey)) return null;
      return apply(trustedUserKey, 'storage', -microSparks, input);
    },
    async getBalance(trustedUserKey: string) {
      if (await isUnlimited(trustedUserKey)) return Number.MAX_SAFE_INTEGER;
      return repository.getBalance(trustedUserKey);
    },
    async getDebt(trustedUserKey: string) {
      if (await isUnlimited(trustedUserKey)) return 0;
      return repository.getDebt?.(trustedUserKey) ?? Promise.resolve(0);
    },
    listHistory(trustedUserKey: string, input?: SparkHistoryInput): Promise<SparkTransaction[]> {
      return repository.listHistory(trustedUserKey, sparkHistoryInputSchema.parse(input ?? {}));
    },
    async getSummary(trustedUserKey: string, input?: SparkHistoryInput, scopeKey?: string) {
      const valid = sparkHistoryInputSchema.parse(input ?? {});
      const requestedScopeKey = scopeKey === undefined ? undefined : z.string().cuid().parse(scopeKey);
      const [microSparkBalance, microSparkDebt, transactions, storageBytes, aiUsageMicroSparks, unlimited] = await Promise.all([
        repository.getBalance(trustedUserKey),
        repository.getDebt?.(trustedUserKey) ?? Promise.resolve(0),
        repository.listHistory(trustedUserKey, valid),
        requestedScopeKey ? getActiveStoredBytesForScope?.(trustedUserKey, requestedScopeKey) ?? Promise.reject(new Error('Scoped storage summaries are unavailable.')) : getActiveStoredBytes(trustedUserKey),
        repository.sumDebits?.(trustedUserKey, 'action') ?? Promise.resolve(0),
        isUnlimited(trustedUserKey),
      ]);
      if (microSparkBalance === null) throw new SparkRepositoryError('USER_NOT_FOUND', 'Spark account user was not found.');
      return {
        microSparkBalance,
        microSparkDebt: microSparkDebt ?? 0,
        spendingBlocked: !unlimited && (microSparkDebt ?? 0) > 0,
        unlimited,
        aiUsageMicroSparks,
        storage: {
          bytes: storageBytes,
          estimatedMonthlyMicroSparks: storageCostMicroSparksExact(calculateByteHours(BigInt(storageBytes), HOURS_PER_BILLING_MONTH)),
        },
        transactions,
      };
    },
  });
}

const storageChargingRepository = getDefaultStorageChargingRepository();
export const sparkService = createSparkService({ repository: createArangoSparkRepository(), getActiveStoredBytes: storageChargingRepository.getActiveStoredBytes, getActiveStoredBytesForScope: storageChargingRepository.getActiveStoredBytesForScope, publishBalance: publishUserEvent });
