import { describe, expect, test } from 'bun:test';
import { HOUR_MS } from './storage-charger';
import { createInboxChargeService, inboxChargerHourJobId, inboxChargerJobSchema, recoverInboxChargingHours } from './inbox-charger-queue';

const window = (hour: number) => { const start = `2026-09-04T${String(hour).padStart(2, '0')}:00:00.000Z`; return { start, end: new Date(Date.parse(start) + HOUR_MS).toISOString() }; };

describe('connected inbox charging queue', () => {
  test('uses strict payloads, deterministic concrete-hour jobs, and oldest-first downtime recovery', async () => {
    expect(inboxChargerHourJobId(window(10))).toMatch(/^[a-f0-9]{64}$/);
    expect(() => inboxChargerJobSchema.parse({ schemaVersion: 1, kind: 'wake', extra: true })).toThrow();
    const added: any[] = [], queue = { async getJob() {}, async add(_name: string, data: unknown, options: unknown) { added.push({ data, options }); return { id: (options as any).jobId }; }, async upsertJobScheduler() {} };
    const repository = { async listMissedClosedHours() { return [window(11), window(9), window(10), window(10)]; } };
    expect(await recoverInboxChargingHours({ repository: repository as never, queue: queue as never })).toEqual({ enqueued: 3 });
    expect(added.map(({ data }) => data.window.start)).toEqual([window(9).start, window(10).start, window(11).start]);
  });

  test('records one idempotent canonical Spark debit with connector attribution', async () => {
    const charges: any[] = [], events: any[] = [];
    const service = createInboxChargeService({ hash: async () => 'a'.repeat(64), id: () => 'event', charge: async (userKey, input) => { charges.push({ userKey, input }); return { status: 'applied', transaction: { key: 'transaction', eventKey: input.eventKey } } as never; }, record: async (input, options) => { events.push({ input, options }); } });
    await service.charge({ connectorKey: 'connector', userKey: 'user', scopeKey: 'immutable-scope', amountMicroSparks: '136986', idempotencyKey: 'b'.repeat(64), hourStart: window(10).start, hourEnd: window(10).end });
    expect(charges[0]).toMatchObject({ userKey: 'user', input: { kind: 'recurring-service', microSparks: 136986, metadata: { category: 'connected-inbox', connectorKey: 'connector', scopeKey: 'immutable-scope' } } });
    expect(events[0]).toMatchObject({ input: { userId: 'user', scopeKey: 'immutable-scope', slug: 'email-inbox.hourly', microSparks: 136986, sparkTransactionKey: 'transaction' }, options: { key: 'event' } });
  });
});
