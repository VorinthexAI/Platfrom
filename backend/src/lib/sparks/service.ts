import { calculateFixedCost, lookupCostRule, storageCostMicroSparks } from '@/lib/costs';
import { sparkHistoryInputSchema, sparkMetadataSchema, type SparkHistoryInput, type SparkMetadata, type SparkTransaction, type SparkTransactionKind } from './contracts';
import type { ApplySparkResult, SparkRepository } from './repository';
import { createArangoSparkRepository, SparkRepositoryError } from './repository';
import { newId } from '@/lib/ids';

type OperationIdentity = Readonly<{ idempotencyKey: string; requestHash: string; eventKey?: string; metadata?: SparkMetadata }>;
type ChargeInput = OperationIdentity & Readonly<{ microSparks: number }>;
type RefundInput = Omit<ChargeInput, 'metadata'> & Readonly<{ chargeTransactionKey: string; executionIdentity?: string }>;
type InvocationInput = OperationIdentity & Readonly<{ toolSlug?: string; actionSlug?: string }>;

export interface SparkServiceDependencies {
  repository: SparkRepository;
  createKey?: () => string;
  now?: () => Date;
}

function positiveSafeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('microSparks must be a positive safe integer.');
  return value;
}

export function createSparkService({ repository, createKey = newId, now = () => new Date() }: SparkServiceDependencies) {
  const apply = (
    trustedUserKey: string,
    kind: SparkTransactionKind,
    deltaMicroSparks: number,
    input: OperationIdentity & Readonly<{ toolSlug?: string; actionSlug?: string }>,
  ) => repository.apply({
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

  return Object.freeze({
    charge(trustedUserKey: string, input: ChargeInput & Readonly<{ kind: 'tool' | 'action' | 'storage' | 'recurring-service'; toolSlug?: string; actionSlug?: string }>) {
      return apply(trustedUserKey, input.kind, -positiveSafeInteger(input.microSparks), input);
    },
    chargeExecution(trustedUserKey: string, input: ChargeInput & Readonly<{ kind: 'tool' | 'action'; toolSlug?: string; actionSlug?: string; executionIdentity: string }>) {
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
      return repository.applyExecutionCharge ? repository.applyExecutionCharge(record, executionIdentity, { owner, now: claimedAt.toISOString(), expiresAt: new Date(claimedAt.getTime() + 5 * 60_000).toISOString() }) : repository.apply(record);
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
    chargeInvocation(trustedUserKey: string, input: InvocationInput): Promise<ApplySparkResult | null> {
      const resolved = lookupCostRule(input);
      if (!resolved) return Promise.resolve(null);
      return apply(trustedUserKey, resolved.source, -calculateFixedCost(resolved.rule), {
        ...input,
        ...(resolved.source === 'tool' ? { toolSlug: resolved.slug } : { actionSlug: resolved.slug }),
      });
    },
    chargeStorage(trustedUserKey: string, input: OperationIdentity & Readonly<{ byteHours: number | bigint }>): Promise<ApplySparkResult | null> {
      const microSparks = storageCostMicroSparks(input.byteHours);
      if (microSparks === 0) return Promise.resolve(null);
      return apply(trustedUserKey, 'storage', -microSparks, input);
    },
    getBalance(trustedUserKey: string) {
      return repository.getBalance(trustedUserKey);
    },
    listHistory(trustedUserKey: string, input?: SparkHistoryInput): Promise<SparkTransaction[]> {
      return repository.listHistory(trustedUserKey, sparkHistoryInputSchema.parse(input ?? {}));
    },
    async getSummary(trustedUserKey: string, input?: SparkHistoryInput) {
      const valid = sparkHistoryInputSchema.parse(input ?? {});
      const [microSparkBalance, transactions] = await Promise.all([
        repository.getBalance(trustedUserKey),
        repository.listHistory(trustedUserKey, valid),
      ]);
      if (microSparkBalance === null) throw new SparkRepositoryError('USER_NOT_FOUND', 'Spark account user was not found.');
      return { microSparkBalance, transactions };
    },
  });
}

export const sparkService = createSparkService({ repository: createArangoSparkRepository() });
