import { z } from 'zod';
import { SparkRepositoryError } from '@/lib/sparks/repository';
import { HOUR_MS, closedStorageHours, floorUtcHour, storageHourWindowSchema } from './storage-charger';

export const INBOX_SPARKS_PER_BILLING_MONTH = 100;
export const INBOX_HOURS_PER_BILLING_MONTH = 730;
export const INBOX_MICRO_SPARK_NUMERATOR = 100_000_000n;
export const INBOX_CHARGE_DENOMINATOR = BigInt(INBOX_HOURS_PER_BILLING_MONTH) * BigInt(HOUR_MS);
export const INBOX_RECOVERY_PAGE_SIZE = 100;

export const inboxHourWindowSchema = storageHourWindowSchema;
export type InboxHourWindow = z.infer<typeof inboxHourWindowSchema>;
export const inboxConnectorUsageSchema = z.object({
  connectorKey: z.string().min(1).max(160),
  userKey: z.string().min(1).max(160),
  scopeKey: z.string().min(1).max(160),
  activeMilliseconds: z.string().regex(/^\d+$/),
  payerAuthorized: z.boolean(),
  recoveryPending: z.boolean(),
}).strict();
export type InboxConnectorUsage = z.infer<typeof inboxConnectorUsageSchema>;

export interface PreparedInboxCharge extends InboxConnectorUsage {
  status: 'pending' | 'completed' | 'unfunded';
  hourStart: string;
  hourEnd: string;
  previousRemainder: string;
  amountMicroSparks: string;
  remainder: string;
  idempotencyKey: string;
}

export interface InboxChargingRepository {
  assertHourReady(window: InboxHourWindow): Promise<void>;
  listConnectorUsage(window: InboxHourWindow): Promise<InboxConnectorUsage[]>;
  prepareConnectorHour(input: InboxConnectorUsage & InboxHourWindow): Promise<PreparedInboxCharge>;
  completeConnectorHour(input: PreparedInboxCharge, completedAt: string): Promise<void>;
  markConnectorHourUnfunded(input: PreparedInboxCharge, failedAt: string, reason?: 'insufficient' | 'authorization'): Promise<void>;
  completeHour(window: InboxHourWindow, completedAt: string): Promise<void>;
  activateConnectorAfterRecovery(connectorKey: string, recoveredAt: string): Promise<boolean>;
  getUnfundedRecoveryCursor(): Promise<string | null>;
  listUnfundedConnectors(afterKey: string | null, limit: number): Promise<{ items: Array<{ connectorKey: string; userKey: string; remainder: string; nextHourMicroSparks: string }>; nextAfterKey: string | null }>;
  beginConnectorFundingRecovery(connectorKey: string, startedAt: string): Promise<boolean>;
  saveUnfundedRecoveryCursor(window: InboxHourWindow, afterKey: string | null): Promise<void>;
}

export interface InboxChargeService {
  charge(input: { connectorKey: string; userKey: string; scopeKey: string; amountMicroSparks: string; idempotencyKey: string; hourStart: string; hourEnd: string }): Promise<unknown>;
}

function canonicalInteger(value: string | bigint, name: string) {
  if (typeof value === 'string' && !/^(0|[1-9]\d*)$/.test(value)) throw new TypeError(`${name} must be a canonical nonnegative integer.`);
  const parsed = BigInt(value);
  if (parsed < 0n) throw new RangeError(`${name} must be nonnegative.`);
  return parsed;
}

export function calculateInboxCharge(activeMilliseconds: string | bigint, previousRemainder: string | bigint = 0n) {
  const usage = canonicalInteger(activeMilliseconds, 'Inbox active time');
  const carry = canonicalInteger(previousRemainder, 'Inbox remainder');
  if (usage > BigInt(HOUR_MS) || carry >= INBOX_CHARGE_DENOMINATOR) throw new RangeError('Inbox active time or remainder is out of range.');
  const numerator = usage * INBOX_MICRO_SPARK_NUMERATOR + carry;
  return { amountMicroSparks: (numerator / INBOX_CHARGE_DENOMINATOR).toString(), remainder: (numerator % INBOX_CHARGE_DENOMINATOR).toString() };
}

export function calculateNextInboxHourCharge(previousRemainder: string | bigint) {
  return calculateInboxCharge(BigInt(HOUR_MS), previousRemainder).amountMicroSparks;
}

export const closedInboxHours = closedStorageHours;

export async function processInboxChargingHour(rawWindow: unknown, dependencies: { repository: InboxChargingRepository; chargeService: InboxChargeService; now?: () => Date }) {
  const window = inboxHourWindowSchema.parse(rawWindow);
  const now = dependencies.now ?? (() => new Date());
  if (Date.parse(window.end) > floorUtcHour(now()).getTime()) throw new RangeError('Inbox charging only accepts fully closed UTC hours.');
  await dependencies.repository.assertHourReady(window);
  const usage = (await dependencies.repository.listConnectorUsage(window)).map((item) => inboxConnectorUsageSchema.parse(item));
  usage.sort((left, right) => left.connectorKey.localeCompare(right.connectorKey));
  let chargedConnectors = 0;
  let chargedMicroSparks = 0n;
  for (const item of usage) {
    const prepared = await dependencies.repository.prepareConnectorHour({ ...window, ...item });
    if (prepared.status !== 'pending') continue;
    if (!item.payerAuthorized) {
      await dependencies.repository.markConnectorHourUnfunded(prepared, now().toISOString(), 'authorization');
      continue;
    }
    if (BigInt(prepared.amountMicroSparks) > 0n) {
      try {
        await dependencies.chargeService.charge(prepared);
      } catch (error) {
        if (!(error instanceof SparkRepositoryError && (error.code === 'INSUFFICIENT_BALANCE' || error.code === 'USER_NOT_FOUND'))) throw error;
        await dependencies.repository.markConnectorHourUnfunded(prepared, now().toISOString(), 'insufficient');
        continue;
      }
      chargedConnectors += 1;
      chargedMicroSparks += BigInt(prepared.amountMicroSparks);
    }
    await dependencies.repository.completeConnectorHour(prepared, now().toISOString());
    if (item.recoveryPending && BigInt(prepared.amountMicroSparks) > 0n) await dependencies.repository.activateConnectorAfterRecovery(item.connectorKey, now().toISOString());
  }
  await dependencies.repository.completeHour(window, now().toISOString());

  const recoveryStart = now().toISOString();
  const recoveryPage = await dependencies.repository.listUnfundedConnectors(await dependencies.repository.getUnfundedRecoveryCursor(), INBOX_RECOVERY_PAGE_SIZE);
  let recoveryStarted = 0;
  for (const connector of recoveryPage.items) if (await dependencies.repository.beginConnectorFundingRecovery(connector.connectorKey, recoveryStart)) recoveryStarted += 1;
  await dependencies.repository.saveUnfundedRecoveryCursor(window, recoveryPage.nextAfterKey);
  return { connectors: usage.length, chargedConnectors, recoveryStarted, chargedMicroSparks: chargedMicroSparks.toString() };
}
