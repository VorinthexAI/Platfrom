import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { calculateInboxCharge, calculateNextInboxHourCharge, closedInboxHours, inboxConnectorUsageSchema, inboxHourWindowSchema, type InboxChargingRepository, type InboxHourWindow, type PreparedInboxCharge } from './inbox-charger';
import { HOUR_MS, floorUtcHour } from './storage-charger';

export const INBOX_BILLING_PERIODS_COLLECTION = 'inboxBillingPeriods';
export const INBOX_CHARGING_HOURS_COLLECTION = 'inboxChargingHours';
export const INBOX_CHARGING_METERS_COLLECTION = 'inboxChargingMeters';

export const inboxBillingPeriodSchema = z.object({ key: z.string().min(1), billingVersion: z.literal(1).optional(), connectorKey: z.string().min(1), userKey: z.string().min(1), organizationKey: z.string().min(1), scopeKey: z.string().min(1), startedAt: z.string().datetime(), endedAt: z.string().datetime().optional() }).strict();
export const inboxChargingHourSchema = z.object({
  key: z.string().min(1), kind: z.enum(['connector-hour', 'hour']), connectorKey: z.string().min(1).optional(), userKey: z.string().min(1).optional(), scopeKey: z.string().min(1).optional(), payerAuthorized: z.boolean().optional(), recoveryPending: z.boolean().optional(), recoveryAfterKey: z.string().min(1).optional(), hourStart: z.string().datetime(), hourEnd: z.string().datetime(), activeMilliseconds: z.string().regex(/^\d+$/).optional(), previousRemainder: z.string().regex(/^\d+$/).optional(), amountMicroSparks: z.string().regex(/^\d+$/).optional(), remainder: z.string().regex(/^\d+$/).optional(), idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/).optional(), status: z.enum(['pending', 'completed', 'unfunded']), completedAt: z.string().datetime().optional(),
}).strict();
export const inboxChargingMeterSchema = z.object({ key: z.string().min(1), connectorKey: z.string().min(1), remainder: z.string().regex(/^\d+$/), lastHourEnd: z.string().datetime(), updatedAt: z.string().datetime() }).strict();

type Cursor = { all(): Promise<unknown[]> };
export interface InboxChargingDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<Cursor> }
type TransactionRunner = <T>(operation: (transaction: InboxChargingDatabase) => Promise<T>) => Promise<T>;
const stableKey = (kind: string, ...parts: string[]) => createHash('sha256').update([kind, ...parts].join('\0')).digest('hex');
export const inboxConnectorHourId = (connectorKey: string, hourStart: string) => stableKey('inbox-connector-hour', connectorKey, hourStart);
export const inboxChargingHourId = (hourStart: string) => stableKey('inbox-hour', hourStart);
export const inboxBillingPeriodId = (connectorKey: string, startedAt: string) => stableKey('inbox-period', connectorKey, startedAt);
const inboxMeterId = (connectorKey: string) => stableKey('inbox-meter', connectorKey);
const first = async (database: InboxChargingDatabase, query: string, bindVars?: Record<string, unknown>) => (await (await database.query(query, bindVars)).all())[0];

export function createInboxChargingRepository(
  database: InboxChargingDatabase = db as unknown as InboxChargingDatabase,
  transact: TransactionRunner = (operation) => withTransaction({ read: [INBOX_BILLING_PERIODS_COLLECTION, 'users'], write: [INBOX_CHARGING_HOURS_COLLECTION, INBOX_CHARGING_METERS_COLLECTION, INBOX_BILLING_PERIODS_COLLECTION, 'organizationConnectors'] }, (transaction) => operation(transaction as unknown as InboxChargingDatabase)),
): InboxChargingRepository & { listMissedClosedHours(now: Date): Promise<InboxHourWindow[]> } {
  return {
    async assertHourReady(rawWindow) {
      const window = inboxHourWindowSchema.parse(rawWindow);
      const oldest = await first(database, 'FOR period IN @@periods FILTER period.billingVersion == 1 && (period.endedAt == null || period.endedAt > period.startedAt) SORT period.startedAt ASC LIMIT 1 RETURN period.startedAt', { '@periods': INBOX_BILLING_PERIODS_COLLECTION });
      if (typeof oldest !== 'string' || Date.parse(window.start) <= floorUtcHour(new Date(oldest)).getTime()) return;
      const previousStart = new Date(Date.parse(window.start) - HOUR_MS).toISOString();
      const previous = await first(database, 'RETURN DOCUMENT(@@hours, @key)', { '@hours': INBOX_CHARGING_HOURS_COLLECTION, key: inboxChargingHourId(previousStart) });
      if (!previous || inboxChargingHourSchema.parse(withArangoKey(previous as Record<string, unknown>)).status !== 'completed') throw new Error(`The prior inbox charging hour ${previousStart} is incomplete.`);
    },
    async listConnectorUsage(rawWindow) {
      const window = inboxHourWindowSchema.parse(rawWindow);
      const cursor = await database.query(`FOR period IN @@periods FILTER period.billingVersion == 1 && period.startedAt < @end && (period.endedAt == null || period.endedAt > @start) LET connector = DOCUMENT(organizationConnectors, period.connectorKey) FILTER connector != null LET membership = FIRST(FOR item IN userOrganizations FILTER item.userId == period.userKey && item.organizationId == period.organizationKey && item.status == "active" LIMIT 1 RETURN item) LET scopeMembership = membership == null ? null : FIRST(FOR item IN scopeMembers FILTER item.scopeKey == period.scopeKey && item.userOrganizationKey == membership._key && item.status == "active" LIMIT 1 RETURN item) LET payerAuthorized = connector.billingUserKey == period.userKey && connector.organizationKey == period.organizationKey && connector.scopeKey == period.scopeKey && DOCUMENT(users, period.userKey) != null && membership != null && scopeMembership != null LET overlapStart = MAX([DATE_TIMESTAMP(period.startedAt), DATE_TIMESTAMP(@start)]) LET overlapEnd = MIN([DATE_TIMESTAMP(NOT_NULL(period.endedAt, @end)), DATE_TIMESTAMP(@end)]) FILTER overlapEnd > overlapStart COLLECT connectorKey = period.connectorKey, userKey = period.userKey, scopeKey = period.scopeKey AGGREGATE activeMilliseconds = SUM(overlapEnd - overlapStart), authorizedCount = MIN(payerAuthorized ? 1 : 0), recoveryCount = MAX(connector.billingStatus == "recovery-pending" ? 1 : 0) SORT connectorKey ASC RETURN { connectorKey, userKey, scopeKey, activeMilliseconds: TO_STRING(activeMilliseconds), payerAuthorized: authorizedCount == 1, recoveryPending: recoveryCount == 1 }`, { '@periods': INBOX_BILLING_PERIODS_COLLECTION, ...window });
      return (await cursor.all()).map((value) => inboxConnectorUsageSchema.parse(value));
    },
    async prepareConnectorHour(raw) {
      const candidate = z.object({ ...inboxConnectorUsageSchema.shape, start: z.string(), end: z.string() }).strict().parse(raw);
      const { start, end, ...usage } = candidate;
      const input = { ...inboxConnectorUsageSchema.parse(usage), ...inboxHourWindowSchema.parse({ start, end }) };
      return transact(async (transaction) => {
        const key = inboxConnectorHourId(input.connectorKey, input.start);
        const existing = await first(transaction, 'RETURN DOCUMENT(@@hours, @key)', { '@hours': INBOX_CHARGING_HOURS_COLLECTION, key });
        if (existing) return inboxChargingHourSchema.parse(withArangoKey(existing as Record<string, unknown>)) as PreparedInboxCharge;
        const earlier = await first(transaction, 'FOR hour IN @@hours FILTER hour.kind == "connector-hour" && hour.connectorKey == @connectorKey && hour.status == "pending" && hour.hourStart < @hourStart LIMIT 1 RETURN true', { '@hours': INBOX_CHARGING_HOURS_COLLECTION, connectorKey: input.connectorKey, hourStart: input.start });
        if (earlier) throw new Error('An earlier inbox charge for this connector is still pending.');
        const meterValue = await first(transaction, 'RETURN DOCUMENT(@@meters, @key)', { '@meters': INBOX_CHARGING_METERS_COLLECTION, key: inboxMeterId(input.connectorKey) });
        const previousRemainder = meterValue ? inboxChargingMeterSchema.parse(withArangoKey(meterValue as Record<string, unknown>)).remainder : '0';
        const calculated = calculateInboxCharge(input.activeMilliseconds, previousRemainder);
        const prepared = inboxChargingHourSchema.parse({ key, kind: 'connector-hour', connectorKey: input.connectorKey, userKey: input.userKey, scopeKey: input.scopeKey, payerAuthorized: input.payerAuthorized, recoveryPending: input.recoveryPending, hourStart: input.start, hourEnd: input.end, activeMilliseconds: input.activeMilliseconds, previousRemainder, ...calculated, idempotencyKey: stableKey('inbox-charge', input.connectorKey, input.start), status: 'pending' });
        await transaction.query('INSERT @document INTO @@hours', { '@hours': INBOX_CHARGING_HOURS_COLLECTION, document: toArangoDoc(prepared) });
        return prepared as PreparedInboxCharge;
      });
    },
    async completeConnectorHour(raw, completedAt) {
      const prepared = inboxChargingHourSchema.parse({ key: inboxConnectorHourId(raw.connectorKey, raw.hourStart), kind: 'connector-hour', ...raw });
      await transact(async (transaction) => {
        const current = await first(transaction, 'RETURN DOCUMENT(@@hours, @key)', { '@hours': INBOX_CHARGING_HOURS_COLLECTION, key: prepared.key });
        if (!current || inboxChargingHourSchema.parse(withArangoKey(current as Record<string, unknown>)).status !== 'pending') return;
        const meter = inboxChargingMeterSchema.parse({ key: inboxMeterId(prepared.connectorKey!), connectorKey: prepared.connectorKey, remainder: prepared.remainder, lastHourEnd: prepared.hourEnd, updatedAt: completedAt });
        await transaction.query('UPSERT { _key: @key } INSERT @meter UPDATE @meter IN @@meters', { '@meters': INBOX_CHARGING_METERS_COLLECTION, key: meter.key, meter: toArangoDoc(meter) });
        await transaction.query('FOR hour IN @@hours FILTER hour._key == @key && hour.status == "pending" UPDATE hour WITH { status: "completed", completedAt: @completedAt } IN @@hours', { '@hours': INBOX_CHARGING_HOURS_COLLECTION, key: prepared.key, completedAt });
      });
    },
    async markConnectorHourUnfunded(raw, failedAt, reason = 'insufficient') {
      const prepared = inboxChargingHourSchema.parse({ key: inboxConnectorHourId(raw.connectorKey, raw.hourStart), kind: 'connector-hour', ...raw });
      await transact(async (transaction) => {
        const meter = inboxChargingMeterSchema.parse({ key: inboxMeterId(prepared.connectorKey!), connectorKey: prepared.connectorKey, remainder: prepared.previousRemainder, lastHourEnd: prepared.hourEnd, updatedAt: failedAt });
        await transaction.query('UPSERT { _key: @key } INSERT @meter UPDATE @meter IN @@meters', { '@meters': INBOX_CHARGING_METERS_COLLECTION, key: meter.key, meter: toArangoDoc(meter) });
        await transaction.query('FOR period IN @@periods FILTER period.connectorKey == @connectorKey && period.endedAt == null UPDATE period WITH { endedAt: @hourEnd } IN @@periods', { '@periods': INBOX_BILLING_PERIODS_COLLECTION, connectorKey: prepared.connectorKey, hourEnd: prepared.hourEnd });
        await transaction.query('FOR connector IN organizationConnectors FILTER connector._key == @connectorKey && connector.status != "revoked" && connector.billingStatus != "disabled" UPDATE connector WITH { billingStatus: "unfunded", syncEnabled: false, syncStatus: "idle", status: "error", lastError: @lastError, syncLeaseToken: null, syncLeaseExpiresAt: null, sendLeaseToken: null, sendLeaseExpiresAt: null, updatedAt: @failedAt } IN organizationConnectors OPTIONS { keepNull: false }', { connectorKey: prepared.connectorKey, failedAt, lastError: reason === 'authorization' ? 'Connected inbox billing owner is no longer authorized' : 'Insufficient Sparks for connected inbox' });
        await transaction.query('FOR hour IN @@hours FILTER hour._key == @key && hour.status == "pending" UPDATE hour WITH { status: "unfunded", completedAt: @failedAt } IN @@hours', { '@hours': INBOX_CHARGING_HOURS_COLLECTION, key: prepared.key, failedAt });
      });
    },
    async completeHour(rawWindow, completedAt) {
      const window = inboxHourWindowSchema.parse(rawWindow);
      const document = inboxChargingHourSchema.parse({ key: inboxChargingHourId(window.start), kind: 'hour', hourStart: window.start, hourEnd: window.end, status: 'completed', completedAt });
      await database.query('UPSERT { _key: @key } INSERT @document UPDATE { status: "completed", completedAt: @completedAt } IN @@hours', { '@hours': INBOX_CHARGING_HOURS_COLLECTION, key: document.key, document: toArangoDoc(document), completedAt });
    },
    async listMissedClosedHours(now) {
      const oldest = await first(database, 'FOR period IN @@periods FILTER period.billingVersion == 1 && (period.endedAt == null || period.endedAt > period.startedAt) SORT period.startedAt ASC LIMIT 1 RETURN period.startedAt', { '@periods': INBOX_BILLING_PERIODS_COLLECTION });
      if (typeof oldest !== 'string') return [];
      const highWater = await first(database, 'FOR hour IN @@hours FILTER hour.kind == "hour" && hour.status == "completed" SORT hour.hourEnd DESC LIMIT 1 RETURN hour.hourEnd', { '@hours': INBOX_CHARGING_HOURS_COLLECTION });
      return closedInboxHours(typeof highWater === 'string' ? highWater : null, now, oldest).slice(0, 24);
    },
    async activateConnectorAfterRecovery(connectorKey, recoveredAt) {
      const cursor = await database.query('FOR connector IN organizationConnectors FILTER connector._key == @connectorKey && connector.status != "revoked" && connector.billingStatus == "recovery-pending" && connector.syncEnabled == false LET period = FIRST(FOR item IN @@periods FILTER item.connectorKey == connector._key && item.endedAt == null && item.startedAt == connector.billingPeriodStartedAt LIMIT 1 RETURN item) FILTER period != null UPDATE connector WITH { billingStatus: "funded", status: "active", syncEnabled: true, lastError: null, updatedAt: @recoveredAt } IN organizationConnectors OPTIONS { keepNull: false } RETURN true', { '@periods': INBOX_BILLING_PERIODS_COLLECTION, connectorKey, recoveredAt });
      return (await cursor.all())[0] === true;
    },
    async getUnfundedRecoveryCursor() {
      const value = await first(database, 'FOR hour IN @@hours FILTER hour.kind == "hour" && hour.status == "completed" SORT hour.hourEnd DESC LIMIT 1 RETURN HAS(hour, "recoveryAfterKey") ? hour.recoveryAfterKey : null', { '@hours': INBOX_CHARGING_HOURS_COLLECTION });
      return typeof value === 'string' ? value : null;
    },
    async listUnfundedConnectors(afterKey, limit) {
      const valid = z.object({ afterKey: z.string().min(1).nullable(), limit: z.number().int().min(1).max(100) }).strict().parse({ afterKey, limit });
      const cursor = await database.query('FOR connector IN organizationConnectors FILTER connector.provider == "gmail" && connector.status != "revoked" && connector.billingStatus == "unfunded" && (@afterKey == null || connector._key > @afterKey) LET membership = FIRST(FOR item IN userOrganizations FILTER item.userId == connector.billingUserKey && item.organizationId == connector.organizationKey && item.status == "active" LIMIT 1 RETURN item) LET scopeMembership = membership == null ? null : FIRST(FOR item IN scopeMembers FILTER item.scopeKey == connector.scopeKey && item.userOrganizationKey == membership._key && item.status == "active" LIMIT 1 RETURN item) FILTER DOCUMENT(users, connector.billingUserKey) != null && membership != null && scopeMembership != null LET meter = DOCUMENT(@@meters, SHA256(CONCAT("inbox-meter\\u0000", connector._key))) SORT connector._key ASC LIMIT @limit RETURN { connectorKey: connector._key, userKey: connector.billingUserKey, remainder: meter == null ? "0" : meter.remainder }', { '@meters': INBOX_CHARGING_METERS_COLLECTION, ...valid });
      const items = z.array(z.object({ connectorKey: z.string().min(1), userKey: z.string().min(1), remainder: z.string().regex(/^\d+$/) }).strict()).parse(await cursor.all()).map((item) => ({ ...item, nextHourMicroSparks: calculateNextInboxHourCharge(item.remainder) }));
      return { items, nextAfterKey: items.length === valid.limit ? items.at(-1)!.connectorKey : null };
    },
    async beginConnectorFundingRecovery(connectorKey, startedAt) {
      const valid = z.object({ connectorKey: z.string().min(1), startedAt: z.string().datetime() }).strict().parse({ connectorKey, startedAt });
      const key = inboxBillingPeriodId(valid.connectorKey, valid.startedAt);
      const cursor = await database.query(`LET connector = DOCUMENT(organizationConnectors, @connectorKey) FILTER connector != null && connector.status != "revoked" && connector.billingStatus == "unfunded" && connector.syncEnabled == false LET membership = FIRST(FOR item IN userOrganizations FILTER item.userId == connector.billingUserKey && item.organizationId == connector.organizationKey && item.status == "active" LIMIT 1 RETURN item) LET scopeMembership = membership == null ? null : FIRST(FOR item IN scopeMembers FILTER item.scopeKey == connector.scopeKey && item.userOrganizationKey == membership._key && item.status == "active" LIMIT 1 RETURN item) FILTER DOCUMENT(users, connector.billingUserKey) != null && membership != null && scopeMembership != null INSERT { _key: @periodKey, billingVersion: 1, connectorKey: connector._key, userKey: connector.billingUserKey, organizationKey: connector.organizationKey, scopeKey: connector.scopeKey, startedAt: @startedAt } INTO @@periods UPDATE connector WITH { billingStatus: "recovery-pending", billingPeriodStartedAt: @startedAt, updatedAt: @startedAt } IN organizationConnectors RETURN true`, { '@periods': INBOX_BILLING_PERIODS_COLLECTION, ...valid, periodKey: key });
      return (await cursor.all())[0] === true;
    },
    async saveUnfundedRecoveryCursor(rawWindow, afterKey) {
      const window = inboxHourWindowSchema.parse(rawWindow);
      await database.query('FOR hour IN @@hours FILTER hour._key == @key && hour.kind == "hour" UPDATE hour WITH { recoveryAfterKey: @afterKey } IN @@hours OPTIONS { keepNull: false }', { '@hours': INBOX_CHARGING_HOURS_COLLECTION, key: inboxChargingHourId(window.start), afterKey });
    },
  };
}

export const getDefaultInboxChargingRepository = () => createInboxChargingRepository();
