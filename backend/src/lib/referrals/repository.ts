import { db, withDatabaseTransaction } from '@/lib/db/client';
import { createHash } from 'node:crypto';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { referralAttributionSchema, type ReferralAttribution } from '@/lib/db/referral-attributions.node';
import { referralCodeSchema, type ReferralCode } from '@/lib/db/referral-codes.node';
import { referralRewardSchema, type ReferralReward } from '@/lib/db/referral-rewards.node';
import { sparkTransactionSchema, type SparkTransaction } from '@/lib/sparks/contracts';
import { SparkRepositoryError } from '@/lib/sparks/repository';
import { referralCompletionSchema, referralRedemptionStatusSchema, referralSummarySchema, type PaidReferralRewardResult, type ReferralCompletion, type ReferralRedemptionStatus, type ReferralSummary } from './contracts';

const USERS_COLLECTION = 'users';
const SPARK_TRANSACTIONS_COLLECTION = 'sparkTransactions';
const REFERRAL_CODES_COLLECTION = 'referralCodes';
const REFERRAL_ATTRIBUTIONS_COLLECTION = 'referralAttributions';
const REFERRAL_REWARDS_COLLECTION = 'referralRewards';
const PAYMENT_ORDERS_COLLECTION = 'paymentOrders';

interface Cursor { next(): Promise<unknown>; all(): Promise<unknown[]> }
export interface ReferralDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<Cursor> }
export type ReferralTransactionRunner = <T>(collections: { read?: string[]; write: string[] }, operation: (transaction: ReferralDatabase) => Promise<T>) => Promise<T>;

export class ReferralRepositoryError extends Error {
  constructor(public readonly code: 'USER_NOT_FOUND' | 'USER_NOT_VERIFIED' | 'INVALID_CODE' | 'SELF_REFERRAL' | 'ALREADY_ATTRIBUTED' | 'PAYMENT_ALREADY_USED' | 'REFERRAL_CODE_MISSING', message: string) {
    super(message);
    this.name = 'ReferralRepositoryError';
  }
}

type RewardWrite = Readonly<{ reward: ReferralReward; transaction: Omit<SparkTransaction, 'balanceAfterMicroSparks'> }>;
type ProposedAttribution = Pick<ReferralAttribution, 'key' | 'referredUserKey' | 'programVersion' | 'createdAt'>;
type ProposedReward = Readonly<{ rewardKey: string; transactionKey: string; microSparks: number; createdAt: string }>;

export interface ReferralRepository {
  ensureCode(input: ReferralCode): Promise<ReferralCode>;
  readSummary(userKey: string): Promise<ReferralSummary>;
  readRedemptionStatus(userKey: string): Promise<ReferralRedemptionStatus>;
  completeVerifiedReferral(input: Readonly<{ referredUserKey: string; normalizedCode: string; attribution: ProposedAttribution; signup: ProposedReward; firstPaid: ProposedReward }>): Promise<ReferralCompletion>;
  applyFirstPaidReward(input: Readonly<{ referredUserKey: string; qualifyingPaymentKey: string; rewardKey: string; transactionKey: string; createdAt: string; microSparks: number }>): Promise<PaidReferralRewardResult>;
  reverseFirstPaidReward(qualifyingPaymentKey: string, reversedAt: string): Promise<{ status: 'applied' | 'replayed'; referrerUserKey: string } | { status: 'not-found' }>;
}

const parseCode = (value: unknown) => referralCodeSchema.parse(withArangoKey(value as Record<string, unknown>));
const parseAttribution = (value: unknown) => referralAttributionSchema.parse(withArangoKey(value as Record<string, unknown>));
const parseReward = (value: unknown) => referralRewardSchema.parse(withArangoKey(value as Record<string, unknown>));
const rewardRequestHash = (attributionKey: string, milestone: string, programVersion: string, microSparks: number, qualifyingPaymentKey?: string) => createHash('sha256').update([attributionKey, milestone, programVersion, qualifyingPaymentKey, microSparks].filter((value) => value !== undefined).join('\0')).digest('hex');

function firstPaidRewardWrite(attribution: ReferralAttribution, qualifyingPaymentKey: string, proposed: ProposedReward): RewardWrite {
  const idempotencyKey = `referral-reward:${attribution.programVersion}:${attribution.key}:first-paid`;
  const requestHash = rewardRequestHash(attribution.key, 'first-paid', attribution.programVersion, proposed.microSparks, qualifyingPaymentKey);
  return {
    reward: referralRewardSchema.parse({ key: proposed.rewardKey, attributionKey: attribution.key, referrerUserKey: attribution.referrerUserKey, referredUserKey: attribution.referredUserKey, milestone: 'first-paid', programVersion: attribution.programVersion, microSparks: proposed.microSparks, sparkTransactionKey: proposed.transactionKey, qualifyingPaymentKey, createdAt: proposed.createdAt }),
    transaction: sparkTransactionSchema.omit({ balanceAfterMicroSparks: true }).parse({ key: proposed.transactionKey, userKey: attribution.referrerUserKey, kind: 'referral-reward', deltaMicroSparks: proposed.microSparks, idempotencyKey, requestHash, metadata: { attributionKey: attribution.key, milestone: 'first-paid', programVersion: attribution.programVersion, qualifyingPaymentKey }, createdAt: proposed.createdAt }),
  };
}

async function persistReward(transaction: ReferralDatabase, attribution: ReferralAttribution, write: RewardWrite): Promise<ReferralCompletion> {
  const existingCursor = await transaction.query(
    'FOR reward IN referralRewards FILTER reward.attributionKey == @attributionKey && reward.milestone == @milestone && reward.programVersion == @programVersion LIMIT 1 RETURN reward',
    { attributionKey: attribution.key, milestone: write.reward.milestone, programVersion: attribution.programVersion },
  );
  const existingValue = await existingCursor.next();
  if (existingValue) return referralCompletionSchema.parse({ status: 'replayed', attribution, reward: parseReward(existingValue) });

  const cursor = await transaction.query(`
    LET user = DOCUMENT(users, @referrerUserKey)
    FILTER user != null
    LET previousBalance = IS_NUMBER(user.microSparkBalance) ? user.microSparkBalance : 0
    LET previousDebt = IS_NUMBER(user.microSparkDebt) ? user.microSparkDebt : 0
    LET debtPayment = MIN([previousDebt, @microSparks])
    LET nextBalance = previousBalance + @microSparks - debtPayment
    FILTER nextBalance >= 0 && nextBalance <= @maxSafeInteger
    UPDATE user WITH { microSparkBalance: nextBalance, microSparkDebt: previousDebt - debtPayment } IN users
    LET ledger = FIRST(INSERT MERGE(@sparkTransaction, { balanceAfterMicroSparks: nextBalance }) INTO sparkTransactions RETURN NEW)
    LET reward = FIRST(INSERT @reward INTO referralRewards RETURN NEW)
    RETURN { ledger, reward }
  `, {
    referrerUserKey: attribution.referrerUserKey,
    microSparks: write.reward.microSparks,
    maxSafeInteger: Number.MAX_SAFE_INTEGER,
    sparkTransaction: toArangoDoc(write.transaction),
    reward: toArangoDoc(write.reward),
  });
  const saved = await cursor.next() as { ledger?: Record<string, unknown>; reward?: Record<string, unknown> } | undefined;
  if (!saved?.ledger || !saved.reward) {
    const userCursor = await transaction.query('LET user = DOCUMENT(users, @userKey) RETURN user == null ? null : user.microSparkBalance', { userKey: attribution.referrerUserKey });
    const balance = await userCursor.next();
    if (balance === null || balance === undefined) throw new SparkRepositoryError('USER_NOT_FOUND', 'Referral reward recipient was not found.');
    if (typeof balance !== 'number' || !Number.isSafeInteger(balance) || balance < 0) throw new SparkRepositoryError('INVALID_BALANCE', 'Stored Spark balance must be a nonnegative safe integer.');
    throw new SparkRepositoryError('BALANCE_OVERFLOW', 'Referral reward would exceed the safe integer range.');
  }
  sparkTransactionSchema.parse(withArangoKey(saved.ledger));
  return referralCompletionSchema.parse({ status: 'applied', attribution, reward: parseReward(saved.reward) });
}

export function createArangoReferralRepository(
  database: ReferralDatabase = db as unknown as ReferralDatabase,
  transact: ReferralTransactionRunner = (collections, operation) => withDatabaseTransaction(database as never, collections, operation as never),
): ReferralRepository {
  const repository: ReferralRepository = {
    async ensureCode(input) {
      const code = referralCodeSchema.parse(input);
      return transact({ read: [USERS_COLLECTION], write: [REFERRAL_CODES_COLLECTION] }, async (transaction) => {
        const cursor = await transaction.query(`
          LET user = DOCUMENT(users, @ownerUserKey)
          FILTER user != null
          LET existing = FIRST(FOR item IN referralCodes FILTER item.ownerUserKey == @ownerUserKey && item.programVersion == @programVersion LIMIT 1 RETURN item)
          LET saved = existing != null ? existing : FIRST(INSERT @code INTO referralCodes RETURN NEW)
          RETURN saved
        `, { ownerUserKey: code.ownerUserKey, programVersion: code.programVersion, code: toArangoDoc(code) });
        const saved = await cursor.next();
        if (!saved) throw new ReferralRepositoryError('USER_NOT_FOUND', 'Referral code owner was not found.');
        return parseCode(saved);
      });
    },

    async readSummary(userKey) {
      const cursor = await database.query(`
        LET code = FIRST(FOR item IN referralCodes FILTER item.ownerUserKey == @userKey && item.programVersion == "v1" LIMIT 1 RETURN item)
        FILTER code != null
        LET attributionCount = LENGTH(FOR item IN referralAttributions FILTER item.referrerUserKey == @userKey && item.programVersion == @programVersion RETURN 1)
        LET rewards = (FOR item IN referralRewards FILTER item.referrerUserKey == @userKey && item.programVersion == @programVersion RETURN item)
        LET invitees = (
          FOR attribution IN referralAttributions
            FILTER attribution.referrerUserKey == @userKey && attribution.programVersion == @programVersion
            SORT attribution.createdAt DESC
            LIMIT 100
            LET user = DOCUMENT(users, attribution.referredUserKey)
            LET attributionKey = PARSE_IDENTIFIER(attribution).key
            LET signupRewardEarned = LENGTH(FOR reward IN rewards FILTER reward.attributionKey == attributionKey && reward.milestone == "signup" LIMIT 1 RETURN 1) > 0
            LET firstPaidReward = FIRST(FOR reward IN rewards FILTER reward.attributionKey == attributionKey && reward.milestone == "first-paid" LIMIT 1 RETURN reward)
            LET displayName = user != null && IS_STRING(user.alias) && LENGTH(TRIM(user.alias)) > 0 ? TRIM(user.alias) : null
            RETURN {
              displayName,
              signupRewardEarned,
              firstPaidRewardStatus: firstPaidReward == null ? "pending" : firstPaidReward.reversedAt == null ? "earned" : "reversed"
            }
        )
        RETURN {
          code,
          attributionCount,
          signupRewardCount: LENGTH(FOR item IN rewards FILTER item.milestone == "signup" RETURN 1),
          paidRewardCount: LENGTH(FOR item IN rewards FILTER item.milestone == "first-paid" && item.reversedAt == null RETURN 1),
          earnedMicroSparks: SUM(FOR item IN rewards FILTER item.milestone != "first-paid" || item.reversedAt == null RETURN item.microSparks),
          invitees
        }
      `, { userKey, programVersion: 'v1' });
      const totals = await cursor.next() as Record<string, unknown> | undefined;
      if (!totals) throw new ReferralRepositoryError('REFERRAL_CODE_MISSING', `Referral code invariant is missing for user ${userKey}.`);
      return referralSummarySchema.parse({ ...totals, code: parseCode(totals.code) });
    },

    async readRedemptionStatus(userKey) {
      const cursor = await database.query(`
        LET attribution = FIRST(FOR item IN referralAttributions FILTER item.referredUserKey == @userKey && item.programVersion == "v1" LIMIT 1 RETURN item)
        LET referrer = attribution == null ? null : DOCUMENT(users, attribution.referrerUserKey)
        LET signup = attribution == null ? null : FIRST(FOR reward IN referralRewards FILTER reward.attributionKey == attribution._key && reward.milestone == "signup" LIMIT 1 RETURN reward)
        LET paid = attribution == null ? null : FIRST(FOR reward IN referralRewards FILTER reward.attributionKey == attribution._key && reward.milestone == "first-paid" LIMIT 1 RETURN reward)
        RETURN {
          attributed: attribution != null,
          referrerName: referrer != null && IS_STRING(referrer.alias) && LENGTH(TRIM(referrer.alias)) > 0 ? TRIM(referrer.alias) : null,
          signupRewardIssued: signup != null,
          firstPaidRewardStatus: attribution == null ? null : paid == null ? "pending" : paid.reversedAt == null ? "earned" : "reversed"
        }
      `, { userKey });
      return referralRedemptionStatusSchema.parse(await cursor.next());
    },

    async completeVerifiedReferral(input) {
      return transact({ read: [REFERRAL_CODES_COLLECTION], write: [USERS_COLLECTION, REFERRAL_ATTRIBUTIONS_COLLECTION, REFERRAL_REWARDS_COLLECTION, SPARK_TRANSACTIONS_COLLECTION, PAYMENT_ORDERS_COLLECTION] }, async (transaction) => {
        const codeCursor = await transaction.query('FOR item IN referralCodes FILTER item.code == @code LIMIT 1 RETURN item', { code: input.normalizedCode });
        const codeValue = await codeCursor.next();
        if (!codeValue) throw new ReferralRepositoryError('INVALID_CODE', 'Referral code was not found.');
        const code = parseCode(codeValue);
        if (code.ownerUserKey === input.referredUserKey) throw new ReferralRepositoryError('SELF_REFERRAL', 'A user cannot refer themselves.');
        const referredCursor = await transaction.query('LET user = DOCUMENT(users, @userKey) RETURN user == null ? null : user.isVerified == true', { userKey: input.referredUserKey });
        const referredIsVerified = await referredCursor.next();
        if (referredIsVerified === null) throw new ReferralRepositoryError('USER_NOT_FOUND', 'Referred user was not found.');
        if (!referredIsVerified) throw new ReferralRepositoryError('USER_NOT_VERIFIED', 'Verify the account before applying a referral code.');
        const existingCursor = await transaction.query('FOR item IN referralAttributions FILTER item.referredUserKey == @referredUserKey && item.programVersion == @programVersion LIMIT 1 RETURN item', { referredUserKey: input.referredUserKey, programVersion: input.attribution.programVersion });
        const existing = await existingCursor.next();
        let attribution: ReferralAttribution;
        if (existing) {
          attribution = parseAttribution(existing);
          if (attribution.referralCodeKey !== code.key) throw new ReferralRepositoryError('ALREADY_ATTRIBUTED', 'A different referral code is already applied to this account.');
        } else {
          attribution = referralAttributionSchema.parse({ ...input.attribution, referralCodeKey: code.key, referrerUserKey: code.ownerUserKey });
          const insertCursor = await transaction.query('INSERT @attribution INTO referralAttributions RETURN NEW', { attribution: toArangoDoc(attribution) });
          attribution = parseAttribution(await insertCursor.next());
        }
        const idempotencyKey = `referral-reward:${attribution.programVersion}:${attribution.key}:signup`;
        const signup = {
          reward: referralRewardSchema.parse({ key: input.signup.rewardKey, attributionKey: attribution.key, referrerUserKey: attribution.referrerUserKey, referredUserKey: attribution.referredUserKey, milestone: 'signup', programVersion: attribution.programVersion, microSparks: input.signup.microSparks, sparkTransactionKey: input.signup.transactionKey, createdAt: input.signup.createdAt }),
          transaction: sparkTransactionSchema.omit({ balanceAfterMicroSparks: true }).parse({ key: input.signup.transactionKey, userKey: attribution.referrerUserKey, kind: 'referral-reward', deltaMicroSparks: input.signup.microSparks, idempotencyKey, requestHash: rewardRequestHash(attribution.key, 'signup', attribution.programVersion, input.signup.microSparks), metadata: { attributionKey: attribution.key, milestone: 'signup', programVersion: attribution.programVersion }, createdAt: input.signup.createdAt }),
        };
        const result = await persistReward(transaction, attribution, signup);
        const paymentCursor = await transaction.query('FOR payment IN paymentOrders FILTER payment.userKey == @referredUserKey && payment.providerSubscriptionId != null && payment.status != "refunded" SORT payment.paidAt ASC, payment._key ASC LIMIT 1 RETURN payment._key', { referredUserKey: input.referredUserKey });
        const qualifyingPaymentKey = await paymentCursor.next();
        if (typeof qualifyingPaymentKey === 'string') await persistReward(transaction, attribution, firstPaidRewardWrite(attribution, qualifyingPaymentKey, input.firstPaid));
        return result;
      });
    },

    async applyFirstPaidReward(input) {
      return transact({ write: [USERS_COLLECTION, REFERRAL_ATTRIBUTIONS_COLLECTION, REFERRAL_REWARDS_COLLECTION, SPARK_TRANSACTIONS_COLLECTION, PAYMENT_ORDERS_COLLECTION] }, async (transaction) => {
        const cursor = await transaction.query('FOR item IN referralAttributions FILTER item.referredUserKey == @referredUserKey && item.programVersion == "v1" LIMIT 1 RETURN item', { referredUserKey: input.referredUserKey });
        const value = await cursor.next();
        if (!value) return { status: 'not-attributed' as const };
        const attribution = parseAttribution(value);
        const eligibilityCursor = await transaction.query('LET payment = DOCUMENT(paymentOrders, @qualifyingPaymentKey) FILTER payment != null && payment.userKey == @referredUserKey && payment.providerSubscriptionId != null && payment.status != "refunded" RETURN true', { qualifyingPaymentKey: input.qualifyingPaymentKey, referredUserKey: input.referredUserKey });
        if (!await eligibilityCursor.next()) return { status: 'not-eligible' as const };
        const paymentCursor = await transaction.query('FOR reward IN referralRewards FILTER reward.qualifyingPaymentKey == @qualifyingPaymentKey LIMIT 1 RETURN reward', { qualifyingPaymentKey: input.qualifyingPaymentKey });
        const paymentRewardValue = await paymentCursor.next();
        if (paymentRewardValue && parseReward(paymentRewardValue).attributionKey !== attribution.key) throw new ReferralRepositoryError('PAYMENT_ALREADY_USED', 'Qualifying payment was already used for another referral.');
        return persistReward(transaction, attribution, firstPaidRewardWrite(attribution, input.qualifyingPaymentKey, input));
      });
    },

    async reverseFirstPaidReward(qualifyingPaymentKey, reversedAt) {
      return transact({ write: [USERS_COLLECTION, REFERRAL_REWARDS_COLLECTION, SPARK_TRANSACTIONS_COLLECTION] }, async (transaction) => {
        const rewardCursor = await transaction.query('FOR item IN referralRewards FILTER item.qualifyingPaymentKey == @qualifyingPaymentKey && item.milestone == "first-paid" LIMIT 1 RETURN item', { qualifyingPaymentKey });
        const value = await rewardCursor.next();
        if (!value) return { status: 'not-found' as const };
        const reward = parseReward(value);
        if (reward.reversedAt) return { status: 'replayed' as const, referrerUserKey: reward.referrerUserKey };
        const transactionKey = createHash('sha256').update(`referral-reversal\0${reward.key}`).digest('hex').slice(0, 25);
        const requestHash = rewardRequestHash(reward.attributionKey, 'first-paid-reversal', reward.programVersion, reward.microSparks, qualifyingPaymentKey);
        const record = sparkTransactionSchema.omit({ balanceAfterMicroSparks: true }).parse({ key: transactionKey, userKey: reward.referrerUserKey, kind: 'adjustment', deltaMicroSparks: -reward.microSparks, idempotencyKey: `referral-reversal:${reward.key}`, requestHash, metadata: { attributionKey: reward.attributionKey, milestone: 'first-paid', category: 'referral-reversal', qualifyingPaymentKey }, createdAt: reversedAt });
        const cursor = await transaction.query(`
          LET user = DOCUMENT(users, @userKey)
          FILTER user != null
          LET balance = IS_NUMBER(user.microSparkBalance) ? user.microSparkBalance : 0
          LET priorDebt = IS_NUMBER(user.microSparkDebt) ? user.microSparkDebt : 0
          LET recovered = MIN([balance, @microSparks])
          LET debt = @microSparks - recovered
          UPDATE user WITH { microSparkBalance: balance - recovered, microSparkDebt: priorDebt + debt } IN users
          LET ledger = recovered == 0 ? null : FIRST(INSERT MERGE(@record, { deltaMicroSparks: -recovered, balanceAfterMicroSparks: balance - recovered }) INTO sparkTransactions RETURN NEW)
          UPDATE @rewardKey WITH { reversalSparkTransactionKey: ledger == null ? null : ledger._key, reversalDebtMicroSparks: debt, reversedAt: @reversedAt } IN referralRewards
          RETURN true
        `, { userKey: reward.referrerUserKey, microSparks: reward.microSparks, record: toArangoDoc(record), rewardKey: reward.key, reversedAt });
        if (!await cursor.next()) throw new SparkRepositoryError('USER_NOT_FOUND', 'Referral reward recipient was not found.');
        return { status: 'applied' as const, referrerUserKey: reward.referrerUserKey };
      });
    },
  };
  return Object.freeze(repository);
}
