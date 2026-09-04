import { db, withDatabaseTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { sparkHistoryInputSchema, sparkTransactionInputSchema, sparkTransactionSchema, type SparkHistoryInput, type SparkTransaction, type SparkTransactionInput } from './contracts';

const SPARK_TRANSACTIONS_COLLECTION = 'sparkTransactions';
const USERS_COLLECTION = 'users';

interface Cursor {
  next(): Promise<unknown>;
  all(): Promise<unknown[]>;
}

export interface SparkDatabase {
  query(query: string, bindVars?: Record<string, unknown>): Promise<Cursor>;
}

export type SparkTransactionRunner = <T>(
  collections: { read?: string[]; write: string[] },
  operation: (transaction: SparkDatabase) => Promise<T>,
) => Promise<T>;

export type ApplySparkTransaction = SparkTransactionInput & Readonly<{ key: string; createdAt: string }>;
export type ApplySparkResult =
  | Readonly<{ status: 'applied'; transaction: SparkTransaction; claimOwner?: string }>
  | Readonly<{ status: 'replayed' | 'pending'; transaction: SparkTransaction }>
  | Readonly<{ status: 'conflict'; transaction: SparkTransaction }>;
export interface SparkExecutionClaim { owner: string; now: string; expiresAt: string }

export interface SparkRepository {
  apply(input: ApplySparkTransaction): Promise<ApplySparkResult>;
  applyExecutionCharge?(input: ApplySparkTransaction, executionIdentity: string, claim?: SparkExecutionClaim): Promise<ApplySparkResult>;
  completeExecution?(userKey: string, executionIdentity: string, owner: string, completedAt: string): Promise<boolean>;
  renewExecution?(userKey: string, executionIdentity: string, owner: string, now: string, expiresAt: string): Promise<boolean>;
  getBalance(userKey: string): Promise<number | null>;
  listHistory(userKey: string, input?: SparkHistoryInput): Promise<SparkTransaction[]>;
}

export class SparkRepositoryError extends Error {
  constructor(public readonly code: 'USER_NOT_FOUND' | 'INSUFFICIENT_BALANCE' | 'INVALID_BALANCE' | 'BALANCE_OVERFLOW' | 'INVALID_REFUND', message: string) {
    super(message);
    this.name = 'SparkRepositoryError';
  }
}

function parseTransaction(value: unknown): SparkTransaction {
  return sparkTransactionSchema.parse(withArangoKey(value as Record<string, unknown>));
}

export function createArangoSparkRepository(
  database: SparkDatabase = db as unknown as SparkDatabase,
  transact: SparkTransactionRunner = (collections, operation) => withDatabaseTransaction(
    database as never,
    collections,
    operation as never,
  ),
): SparkRepository {
  const repository: SparkRepository = {
    async apply(input) {
      const { key: _key, createdAt: _createdAt, ...transactionFields } = input;
      const transactionInput = sparkTransactionInputSchema.parse(transactionFields);
      const record = sparkTransactionSchema.omit({ balanceAfterMicroSparks: true }).parse(input);
      return transact({ write: [USERS_COLLECTION, SPARK_TRANSACTIONS_COLLECTION] }, async (transaction) => {
        const replayCursor = await transaction.query(
          'FOR item IN sparkTransactions FILTER item.userKey == @userKey && item.idempotencyKey == @idempotencyKey LIMIT 1 RETURN item',
          { userKey: transactionInput.userKey, idempotencyKey: transactionInput.idempotencyKey },
        );
        const replay = await replayCursor.next();
        if (replay) {
          const existing = parseTransaction(replay);
          return existing.requestHash === transactionInput.requestHash
            ? { status: 'replayed' as const, transaction: existing }
            : { status: 'conflict' as const, transaction: existing };
        }

        if (transactionInput.kind === 'refund') {
          if (typeof transactionInput.metadata?.refundOfTransactionKey !== 'string') throw new SparkRepositoryError('INVALID_REFUND', 'A Spark refund must identify its original debit.');
          const originalCursor = await transaction.query(
            'FOR item IN sparkTransactions FILTER item._key == @transactionKey && item.userKey == @userKey LIMIT 1 RETURN item',
            { transactionKey: transactionInput.metadata.refundOfTransactionKey, userKey: transactionInput.userKey },
          );
          const originalValue = await originalCursor.next();
          if (!originalValue) throw new SparkRepositoryError('INVALID_REFUND', 'The original Spark charge was not found.');
          const original = parseTransaction(originalValue);
          if (original.deltaMicroSparks >= 0) throw new SparkRepositoryError('INVALID_REFUND', 'Only a Spark debit can be refunded.');
          if (typeof original.metadata?.executionIdentity === 'string' && transactionInput.deltaMicroSparks !== -original.deltaMicroSparks) {
            throw new SparkRepositoryError('INVALID_REFUND', 'Execution charges require one full refund.');
          }
          const refundsCursor = await transaction.query(
            'FOR item IN sparkTransactions FILTER item.userKey == @userKey && item.kind == "refund" && item.metadata.refundOfTransactionKey == @transactionKey RETURN item.deltaMicroSparks',
            { transactionKey: original.key, userKey: transactionInput.userKey },
          );
          const alreadyRefunded = (await refundsCursor.all()).reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
          if (alreadyRefunded + transactionInput.deltaMicroSparks > -original.deltaMicroSparks) throw new SparkRepositoryError('INVALID_REFUND', 'Spark refunds cannot exceed the original debit.');
        }

        const cursor = await transaction.query(`
          LET user = DOCUMENT(users, @userKey)
          FILTER user != null
          LET previousBalance = IS_NUMBER(user.microSparkBalance) ? user.microSparkBalance : 0
          LET nextBalance = previousBalance + @deltaMicroSparks
          FILTER nextBalance >= 0 && nextBalance <= @maxSafeInteger
          UPDATE user WITH { microSparkBalance: nextBalance } IN users
          LET ledgerRecord = MERGE(@record, { balanceAfterMicroSparks: nextBalance })
          INSERT ledgerRecord INTO sparkTransactions
          RETURN ledgerRecord
        `, {
          userKey: transactionInput.userKey,
          deltaMicroSparks: transactionInput.deltaMicroSparks,
          maxSafeInteger: Number.MAX_SAFE_INTEGER,
          record: toArangoDoc(record),
        });
        const saved = await cursor.next();
        if (!saved) {
          const userCursor = await transaction.query('LET user = DOCUMENT(users, @userKey) RETURN user == null ? null : (IS_NUMBER(user.microSparkBalance) ? user.microSparkBalance : 0)', { userKey: transactionInput.userKey });
          const currentBalance = await userCursor.next();
          if (currentBalance === null || currentBalance === undefined) throw new SparkRepositoryError('USER_NOT_FOUND', 'Spark account user was not found.');
          if (typeof currentBalance !== 'number' || !Number.isSafeInteger(currentBalance) || currentBalance < 0) throw new SparkRepositoryError('INVALID_BALANCE', 'Stored Spark balance must be a nonnegative safe integer.');
          if (currentBalance + transactionInput.deltaMicroSparks < 0) throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'Spark balance is insufficient for this transaction.');
          throw new SparkRepositoryError('BALANCE_OVERFLOW', 'Spark balance would exceed the safe integer range.');
        }
        return { status: 'applied' as const, transaction: parseTransaction(saved) };
      });
    },

    async applyExecutionCharge(input, executionIdentity, claim = { owner: input.key, now: input.createdAt, expiresAt: input.createdAt }) {
      const { key: _key, createdAt: _createdAt, ...transactionFields } = input;
      const transactionInput = sparkTransactionInputSchema.parse(transactionFields);
      const record = sparkTransactionSchema.omit({ balanceAfterMicroSparks: true }).parse(input);
      return transact({ write: [USERS_COLLECTION, SPARK_TRANSACTIONS_COLLECTION, 'billingExecutions'] }, async (transaction) => {
        const executionCursor = await transaction.query(
          'FOR item IN billingExecutions FILTER item.userKey == @userKey && item.executionIdentity == @executionIdentity LIMIT 1 RETURN item',
          { userKey: input.userKey, executionIdentity },
        );
        const execution = await executionCursor.next() as Record<string, unknown> | undefined;
        let latest: SparkTransaction | undefined;
        if (execution && typeof execution.chargeTransactionKey === 'string') {
          const chargeCursor = await transaction.query('LET item = DOCUMENT(sparkTransactions, @key) RETURN item', { key: execution.chargeTransactionKey });
          const value = await chargeCursor.next();
          if (value) latest = parseTransaction(value);
        }
        if (latest && latest.requestHash !== input.requestHash) return { status: 'conflict' as const, transaction: latest };
        const refundCursor = latest ? await transaction.query(
          'FOR item IN sparkTransactions FILTER item.userKey == @userKey && item.kind == "refund" && item.metadata.refundOfTransactionKey == @transactionKey LIMIT 1 RETURN item',
          { userKey: input.userKey, transactionKey: latest.key },
        ) : null;
        const refunded = Boolean(await refundCursor?.next());
        if (latest && !refunded && execution?.status === 'completed') return { status: 'replayed' as const, transaction: latest };
        if (latest && !refunded && execution?.status === 'pending') {
          if (typeof execution.leaseExpiresAt === 'string' && execution.leaseExpiresAt > claim.now) return { status: 'pending' as const, transaction: latest };
          await transaction.query(`
            UPDATE @executionKey WITH { leaseOwner: @owner, leaseExpiresAt: @expiresAt, updatedAt: @now, recoveryCount: @recoveryCount } IN billingExecutions
          `, { executionKey: execution._key, owner: claim.owner, expiresAt: claim.expiresAt, now: claim.now, recoveryCount: typeof execution.recoveryCount === 'number' ? execution.recoveryCount + 1 : 1 });
          return { status: 'applied' as const, transaction: latest, claimOwner: claim.owner };
        }
        const attempt = latest && typeof latest.metadata?.executionAttempt === 'number' ? latest.metadata.executionAttempt + 1 : 1;
        const attempted = {
          ...record,
          idempotencyKey: `${input.idempotencyKey}:a${attempt}`,
          metadata: { ...record.metadata, executionIdentity, executionAttempt: attempt },
        };
        const cursor = await transaction.query(`
          LET user = DOCUMENT(users, @userKey)
          FILTER user != null
          LET previousBalance = IS_NUMBER(user.microSparkBalance) ? user.microSparkBalance : 0
          LET nextBalance = previousBalance + @deltaMicroSparks
          FILTER nextBalance >= 0 && nextBalance <= @maxSafeInteger
          UPDATE user WITH { microSparkBalance: nextBalance } IN users
          LET ledgerRecord = MERGE(@record, { balanceAfterMicroSparks: nextBalance })
          INSERT ledgerRecord INTO sparkTransactions
          RETURN ledgerRecord
        `, { userKey: transactionInput.userKey, deltaMicroSparks: transactionInput.deltaMicroSparks, maxSafeInteger: Number.MAX_SAFE_INTEGER, record: toArangoDoc(attempted) });
        const saved = await cursor.next();
        if (!saved) {
          const userCursor = await transaction.query('LET user = DOCUMENT(users, @userKey) RETURN user == null ? null : (IS_NUMBER(user.microSparkBalance) ? user.microSparkBalance : 0)', { userKey: transactionInput.userKey });
          const currentBalance = await userCursor.next();
          if (currentBalance === null || currentBalance === undefined) throw new SparkRepositoryError('USER_NOT_FOUND', 'Spark account user was not found.');
          if (typeof currentBalance !== 'number' || !Number.isSafeInteger(currentBalance) || currentBalance < 0) throw new SparkRepositoryError('INVALID_BALANCE', 'Stored Spark balance must be a nonnegative safe integer.');
          if (currentBalance + transactionInput.deltaMicroSparks < 0) throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'Spark balance is insufficient for this transaction.');
          throw new SparkRepositoryError('BALANCE_OVERFLOW', 'Spark balance would exceed the safe integer range.');
        }
        const parsed = parseTransaction(saved);
        if (execution && typeof execution._key === 'string') {
          await transaction.query(`
            UPDATE @executionKey WITH { status: "pending", requestHash: @requestHash, attempt: @attempt, chargeTransactionKey: @chargeTransactionKey, leaseOwner: @owner, leaseExpiresAt: @expiresAt, updatedAt: @now } IN billingExecutions
          `, { executionKey: execution._key, requestHash: input.requestHash, attempt, chargeTransactionKey: parsed.key, owner: claim.owner, expiresAt: claim.expiresAt, now: claim.now });
        } else {
          await transaction.query(`
            INSERT { _key: @executionKey, userKey: @userKey, executionIdentity: @executionIdentity, requestHash: @requestHash, status: "pending", attempt: @attempt, chargeTransactionKey: @chargeTransactionKey, leaseOwner: @owner, leaseExpiresAt: @expiresAt, recoveryCount: 0, createdAt: @now, updatedAt: @now } INTO billingExecutions
          `, { executionKey: input.key, userKey: input.userKey, executionIdentity, requestHash: input.requestHash, attempt, chargeTransactionKey: parsed.key, owner: claim.owner, expiresAt: claim.expiresAt, now: claim.now });
        }
        return { status: 'applied' as const, transaction: parsed, claimOwner: claim.owner };
      });
    },

    async completeExecution(userKey, executionIdentity, owner, completedAt) {
      return transact({ write: ['billingExecutions'] }, async (transaction) => {
        const cursor = await transaction.query(`
          FOR item IN billingExecutions
            FILTER item.userKey == @userKey && item.executionIdentity == @executionIdentity && item.status == "pending" && item.leaseOwner == @owner
            UPDATE item WITH { status: "completed", completedAt: @completedAt, updatedAt: @completedAt, leaseOwner: null, leaseExpiresAt: null } IN billingExecutions OPTIONS { keepNull: false }
            RETURN true
        `, { userKey, executionIdentity, owner, completedAt });
        return Boolean(await cursor.next());
      });
    },

    async renewExecution(userKey, executionIdentity, owner, now, expiresAt) {
      return transact({ write: ['billingExecutions'] }, async (transaction) => {
        const cursor = await transaction.query(`
          FOR item IN billingExecutions
            FILTER item.userKey == @userKey && item.executionIdentity == @executionIdentity && item.status == "pending" && item.leaseOwner == @owner
            UPDATE item WITH { leaseExpiresAt: @expiresAt, updatedAt: @now } IN billingExecutions
            RETURN true
        `, { userKey, executionIdentity, owner, now, expiresAt });
        return Boolean(await cursor.next());
      });
    },

    async getBalance(userKey) {
      const cursor = await database.query(
        'LET user = DOCUMENT(users, @userKey) RETURN user == null ? null : (IS_NUMBER(user.microSparkBalance) ? user.microSparkBalance : 0)',
        { userKey },
      );
      const value = await cursor.next();
      if (value === null || value === undefined) return null;
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new SparkRepositoryError('INVALID_BALANCE', 'Stored Spark balance must be a nonnegative safe integer.');
      return value as number;
    },

    async listHistory(userKey, input = { limit: 50 }) {
      const valid = sparkHistoryInputSchema.parse(input);
      const cursor = await database.query(`
        FOR item IN sparkTransactions
          FILTER item.userKey == @userKey
          FILTER @beforeCreatedAt == null || item.createdAt < @beforeCreatedAt || (item.createdAt == @beforeCreatedAt && item._key < @beforeKey)
          SORT item.createdAt DESC, item._key DESC
          LIMIT @limit
          RETURN item
      `, { userKey, beforeCreatedAt: valid.beforeCreatedAt ?? null, beforeKey: valid.beforeKey ?? null, limit: valid.limit });
      return (await cursor.all()).map(parseTransaction);
    },
  };
  return Object.freeze(repository);
}
