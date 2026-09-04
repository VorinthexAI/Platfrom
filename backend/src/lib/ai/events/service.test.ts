import { describe, expect, test } from 'bun:test';
import { createToolEventService, toolEventInputSchema } from './service';
import { addToolTokenUsage, chargeToolOutcome, currentFixedChargeReceipt, markFixedChargeOutcomeAccepted, markToolOutcomeAccepted, observeToolExecution, recordActionCost, recordActionUsage, runWithEventApp, SparkExecutionPendingError, SparkRefundError } from './runtime';
import { APP_KEYS } from '@/lib/apps/registry';

describe('tool events', () => {
  test('persists the normalized event fields without an embedding or payload', async () => {
    const inserted: Record<string, unknown>[] = [];
    const service = createToolEventService({
      id: () => 'event-1',
      now: () => '2026-09-02T12:00:00.000Z',
      insert: async (event) => { inserted.push(event); return event as never; },
      appExists: async () => true,
    });
    await service.record({ userId: 'user-1', scopeKey: 'scope-1', slug: 'document.summarize', appKey: APP_KEYS.ARCHIVE, microSparks: 2_000_000, inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(inserted[0]).toEqual({ key: 'event-1', userId: 'user-1', scopeKey: 'scope-1', slug: 'document.summarize', appKey: APP_KEYS.ARCHIVE, createdAt: '2026-09-02T12:00:00.000Z', status: 'completed', microSparks: 2_000_000, sparkTransactionKey: null, inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  test('accepts registry-style slugs without maintaining an event allowlist', () => {
    expect(toolEventInputSchema.parse({ userId: null, scopeKey: 'scope-1', slug: 'future-capability.execute', appKey: APP_KEYS.CORE }).slug).toBe('future-capability.execute');
    expect(() => toolEventInputSchema.parse({ userId: null, scopeKey: '', slug: 'future-capability.execute', appKey: APP_KEYS.CORE })).toThrow();
    expect(() => toolEventInputSchema.parse({ userId: null, scopeKey: null, slug: 'future-capability.execute', appKey: APP_KEYS.CORE })).toThrow();
    expect(() => toolEventInputSchema.parse({ userId: null, scopeKey: 'scope-1', slug: 'not dotted', appKey: APP_KEYS.CORE })).toThrow();
    expect(() => toolEventInputSchema.parse({ userId: null, scopeKey: 'scope-1', slug: 'folder.create', appKey: 'unknown' })).toThrow();
  });

  test('records request app and accumulated provider usage after execution', async () => {
    const events: Record<string, unknown>[] = [];
    const recorder = async (event: Record<string, unknown>) => { events.push(event); };
    await runWithEventApp(APP_KEYS.GALLERY, async () => {
      await observeToolExecution('image.generate', { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'system' } }, async () => {
        addToolTokenUsage({ inputTokens: 4, outputTokens: 6, totalTokens: 10 });
        return 'ok';
      });
    }, recorder);
    await Promise.resolve();
    expect(events).toEqual([{ userId: null, scopeKey: 'scope-1', slug: 'image.generate', appKey: APP_KEYS.GALLERY, status: 'completed', microSparks: 0, sparkTransactionKey: null, inputTokens: 4, outputTokens: 6, totalTokens: 10 }]);
  });

  test('rejects an unknown app before inserting', async () => {
    let inserts = 0;
    const service = createToolEventService({ appExists: async () => false, insert: async () => { inserts += 1; return {} as never; } });
    await expect(service.record({ userId: null, scopeKey: 'scope-1', slug: 'folder.create', appKey: APP_KEYS.CORE })).rejects.toThrow('was not found');
    expect(inserts).toBe(0);
  });

  test('charges successful tools once and gives tool pricing precedence over enclosed actions', async () => {
    const events: unknown[] = [], charges: Array<{ userKey: string; input: Record<string, unknown> }> = [];
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    await observeToolExecution('document.summarize', context, async () => { await recordActionCost('text.generate'); return 'ok'; }, {
      recorder: async (input) => { events.push(input); }, idempotencyKey: 'request-1', id: () => 'event-1', hash: async () => 'a'.repeat(64),
      lookupCost: (input) => input.toolSlug ? { source: 'tool', slug: input.toolSlug, rule: { type: 'fixed', microSparks: 300 } } : { source: 'action', slug: input.actionSlug!, rule: { type: 'fixed', microSparks: 200 } },
      charge: async (userKey, input) => { charges.push({ userKey, input }); return { status: 'applied', transaction: { key: 'transaction-1', eventKey: input.eventKey } } as never; },
    });
    expect(charges).toEqual([{ userKey: 'user-1', input: { kind: 'tool', microSparks: 300, idempotencyKey: `execution:${'a'.repeat(64)}`, executionIdentity: 'a'.repeat(64), requestHash: 'a'.repeat(64), eventKey: 'event-1', toolSlug: 'document.summarize', metadata: { paidOutcome: 'operation-completed' } } }]);
    expect(events).toEqual([expect.objectContaining({ status: 'completed', microSparks: 300, sparkTransactionKey: 'transaction-1' })]);
  });

  test('never charges failed work even when an enclosed action is priced', async () => {
    const events: Record<string, unknown>[] = []; let charges = 0;
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    await expect(observeToolExecution('document.summarize', context, async () => { await recordActionCost('text.generate'); throw new Error('provider failed'); }, {
      recorder: async (input) => { events.push(input as Record<string, unknown>); }, idempotencyKey: 'request-1',
      lookupCost: (input) => input.actionSlug ? { source: 'action', slug: input.actionSlug, rule: { type: 'fixed', microSparks: 200 } } : null,
      charge: async () => { charges += 1; return {} as never; },
    })).rejects.toThrow('provider failed');
    expect(charges).toBe(0);
    expect(events).toEqual([expect.objectContaining({ status: 'failed', microSparks: 0, sparkTransactionKey: null })]);
  });

  test('charges each successful action immediately with stable usage-free identities', async () => {
    const charged: Record<string, unknown>[] = [];
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    await observeToolExecution('document.summarize', context, async () => { await recordActionCost('text.generate'); await recordActionUsage('text.generate', {}, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }); await recordActionCost('text.generate'); await recordActionUsage('text.generate', {}, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }); }, {
      recorder: async () => {}, idempotencyKey: 'request-1', id: () => 'event-1', hash: async () => 'a'.repeat(64),
      lookupCost: (input) => input.actionSlug ? { source: 'action', slug: input.actionSlug, rule: { type: 'fixed', microSparks: 200 } } : null,
      charge: async (_userKey, input) => { charged.push(input); return { status: 'applied', transaction: { key: `transaction-${charged.length}` } } as never; },
    });
    expect(charged).toHaveLength(2);
    expect(charged[0]).toMatchObject({ kind: 'action', actionSlug: 'text.generate', microSparks: 200, metadata: { amountMicroSparks: 200 } });
    expect(charged[0]?.requestHash).toBe(charged[1]?.requestHash);
    expect(JSON.stringify(charged)).not.toContain('usage');
  });

  test('keeps action request identity stable across usage and refunds an owned action when outer work fails', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    const charges: Record<string, unknown>[] = [];
    const refunds: Record<string, unknown>[] = [];
    const run = (usage: { inputTokens: number; outputTokens: number; totalTokens: number }, fail = false) => observeToolExecution('app.translate', context, async () => {
      await recordActionCost('text');
      await recordActionUsage('text', { messages: ['same'] }, usage);
      if (fail) throw new Error('persistence failed');
      return 'ok';
    }, {
      recorder: async () => {}, idempotencyKey: 'same-request',
      charge: async (_userKey, input) => { charges.push(input); return { status: 'applied', transaction: { key: `charge-${charges.length}` } } as never; },
      refund: async (_userKey, input) => { refunds.push(input); return { status: 'applied', transaction: { key: `refund-${refunds.length}` } } as never; },
    });
    await run({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    await expect(run({ inputTokens: 2, outputTokens: 3, totalTokens: 5 }, true)).rejects.toThrow('persistence failed');
    expect(charges[0]?.requestHash).toBe(charges[1]?.requestHash);
    expect(charges[0]?.metadata).not.toEqual(charges[1]?.metadata);
    expect(refunds).toEqual([expect.objectContaining({ microSparks: 1_600, chargeTransactionKey: 'charge-2' })]);
  });

  test('reuses the original event key from a replayed charge', async () => {
    let recordedKey: string | undefined;
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    await observeToolExecution('document.summarize', context, async () => 'ok', {
      recorder: async (_input, options) => { recordedKey = options?.key; }, idempotencyKey: 'request-1', id: () => 'new-event', hash: async () => 'a'.repeat(64),
      lookupCost: (input) => input.toolSlug ? { source: 'tool', slug: input.toolSlug, rule: { type: 'fixed', microSparks: 300 } } : null,
      charge: async () => ({ status: 'replayed', transaction: { key: 'transaction-1', eventKey: 'original-event' } }) as never,
    });
    expect(recordedKey).toBe('original-event');

    await expect(observeToolExecution('document.summarize', context, async () => 'ok', {
      recorder: async () => {}, idempotencyKey: 'request-1', hash: async () => 'a'.repeat(64),
      lookupCost: (input) => input.toolSlug ? { source: 'tool', slug: input.toolSlug, rule: { type: 'fixed', microSparks: 300 } } : null,
      charge: async () => ({ status: 'replayed', transaction: { key: 'transaction-1' } }) as never,
    })).rejects.toThrow('did not retain an analytics event key');
  });

  test('does not charge system principals even when the tool is priced', async () => {
    let charges = 0, ids = 0, hashes = 0; const events: Record<string, unknown>[] = [];
    await observeToolExecution('document.summarize', { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'system' } }, async () => { await recordActionCost('text.generate'); }, {
      recorder: async (input) => { events.push(input as Record<string, unknown>); },
      lookupCost: (input) => ({ source: input.toolSlug ? 'tool' : 'action', slug: input.toolSlug ?? input.actionSlug!, rule: { type: 'fixed', microSparks: 300 } }),
      charge: async () => { charges += 1; return {} as never; }, id: () => { ids += 1; return 'event'; }, hash: async () => { hashes += 1; return 'a'.repeat(64); },
    });
    expect({ charges, ids, hashes }).toEqual({ charges: 0, ids: 0, hashes: 0 });
    expect(events).toEqual([expect.objectContaining({ userId: null, status: 'completed', microSparks: 0 })]);
  });

  test('keeps execution outcomes authoritative when analytics recording fails', async () => {
    const failure = new Error('business failure');
    await expect(observeToolExecution('document.read', { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'system' } }, async () => 'result', { recorder: async () => { throw new Error('analytics unavailable'); } })).resolves.toBe('result');
    await expect(observeToolExecution('document.read', { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'system' } }, async () => { throw failure; }, { recorder: async () => { throw new Error('analytics unavailable'); } })).rejects.toBe(failure);
  });

  test('rejects billable tools and actions without a stable request key before billable work starts', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    let toolWork = 0;
    await expect(observeToolExecution('document.summarize', context, async () => { toolWork += 1; }, {
      recorder: async () => {}, lookupCost: (input) => input.toolSlug ? { source: 'tool', slug: input.toolSlug, rule: { type: 'fixed', microSparks: 300 } } : null,
    })).rejects.toThrow('stable request key');
    expect(toolWork).toBe(0);

    let providerWork = 0;
    await expect(observeToolExecution('document.read', context, async () => { await recordActionCost('text.generate'); providerWork += 1; }, {
      recorder: async () => {}, lookupCost: (input) => input.actionSlug ? { source: 'action', slug: input.actionSlug, rule: { type: 'fixed', microSparks: 200 } } : null,
    })).rejects.toThrow('stable request key');
    expect(providerWork).toBe(0);
  });

  test('reuses one ledger debit when the same stable execution key is retried', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    const ledger = new Map<string, { key: string; eventKey?: string }>(); let debits = 0; const recordedKeys: Array<string | undefined> = [];
    const run = () => observeToolExecution('document.summarize', context, async () => 'ok', {
      recorder: async (_input, options) => { recordedKeys.push(options?.key); }, idempotencyKey: 'stable-request', id: () => `event-${ledger.size + 1}`, hash: async () => 'a'.repeat(64),
      lookupCost: (input) => input.toolSlug ? { source: 'tool', slug: input.toolSlug, rule: { type: 'fixed', microSparks: 300 } } : null,
      charge: async (_userKey, input) => {
        const existing = ledger.get(input.idempotencyKey);
        if (existing) return { status: 'replayed', transaction: existing } as never;
        debits += 1;
        const transaction = { key: 'transaction-1', eventKey: input.eventKey };
        ledger.set(input.idempotencyKey, transaction);
        return { status: 'applied', transaction } as never;
      },
    });
    await run();
    await run();
    expect(debits).toBe(1);
    expect([...ledger.keys()]).toEqual([`execution:${'a'.repeat(64)}`]);
    expect(recordedKeys).toEqual(['event-1', 'event-1']);
  });

  test('normalizes long stable request keys into bounded deterministic ledger keys', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    const ledgerKeys: string[] = [];
    const run = () => observeToolExecution('document.summarize', context, async () => 'ok', {
      recorder: async () => {}, idempotencyKey: 'r'.repeat(200), hash: async () => 'a'.repeat(64),
      lookupCost: (input) => input.toolSlug ? { source: 'tool', slug: input.toolSlug, rule: { type: 'fixed', microSparks: 1 } } : null,
      charge: async (_userKey, input) => { ledgerKeys.push(input.idempotencyKey); return { status: 'applied', transaction: { key: 'transaction-1', eventKey: input.eventKey } } as never; },
    });
    await run();
    await run();
    expect(ledgerKeys[0]).toMatch(/^execution:[a-f0-9]{64}$/);
    expect(ledgerKeys[1]).toBe(ledgerKeys[0]);
  });

  test('predebits fixed work and issues a full linked refund on failure', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    const order: string[] = [];
    let refundInput: Record<string, unknown> | undefined;
    await expect(observeToolExecution('book.create', context, async () => { order.push('work'); throw new Error('failed'); }, {
      input: { title: 'A' }, idempotencyKey: 'request', recorder: async () => {}, id: () => 'event-1', hash: async () => 'b'.repeat(64),
      charge: async (_userKey, input) => { order.push('debit'); return { status: 'applied', transaction: { key: 'charge-1', eventKey: input.eventKey } } as never; },
      refund: async (_userKey, input) => { order.push('refund'); refundInput = input; return { status: 'applied', transaction: { key: 'refund-1' } } as never; },
    })).rejects.toThrow('failed');
    expect(order).toEqual(['debit', 'work', 'refund']);
    expect(refundInput).toMatchObject({ microSparks: 100_000_000, idempotencyKey: 'refund:charge-1', chargeTransactionKey: 'charge-1' });
    expect(refundInput).not.toHaveProperty('eventKey');
  });

  test('exposes applied and replayed fixed-charge receipts only inside canonical execution', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    const seen: unknown[] = [];
    for (const status of ['applied', 'replayed'] as const) await observeToolExecution('book.create', context, async () => { seen.push(currentFixedChargeReceipt('book.create')); }, {
      input: {}, idempotencyKey: 'request', recorder: async () => {}, hash: async () => 'a'.repeat(64),
      charge: async (_userKey, input) => ({ status, transaction: { key: 'charge-1', eventKey: input.eventKey } }) as never,
    });
    expect(seen).toEqual([
      { userKey: 'user-1', toolSlug: 'book.create', microSparks: 100_000_000, transactionKey: 'charge-1', executionIdentity: 'a'.repeat(64), replayed: false },
      { userKey: 'user-1', toolSlug: 'book.create', microSparks: 100_000_000, transactionKey: 'charge-1', executionIdentity: 'a'.repeat(64), replayed: true },
    ]);
    expect(currentFixedChargeReceipt()).toBeNull();
  });

  test('completes rather than refunds a fixed charge after durable queue acceptance', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    let completed = 0, refunded = 0;
    await expect(observeToolExecution('book.create', context, async () => {
      markFixedChargeOutcomeAccepted('book.create');
      throw new Error('response projection failed');
    }, {
      input: {}, idempotencyKey: 'accepted-request', recorder: async () => {}, hash: async () => 'e'.repeat(64),
      charge: async (_userKey, input) => ({ status: 'applied', claimOwner: 'owner', transaction: { key: 'charge-1', eventKey: input.eventKey } }) as never,
      complete: async () => { completed += 1; return true; },
      refund: async () => { refunded += 1; return {} as never; },
    })).rejects.toThrow('response projection failed');
    expect({ completed, refunded }).toEqual({ completed: 1, refunded: 0 });
  });

  test('prices Core extension preview by its action usage instead of the fixed generation charge', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    const charges: Record<string, unknown>[] = [];
    await observeToolExecution('book.extend', context, async () => {
      expect(currentFixedChargeReceipt()).toBeNull();
      await recordActionCost('text');
      await recordActionUsage('text', {}, { inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    }, {
      input: { mode: 'preview', bookKey: 'book', chapterCount: 1 }, idempotencyKey: 'preview-1', recorder: async () => {}, getBalance: async () => 1_000_000_000,
      charge: async (_userKey, input) => { charges.push(input); return { status: 'applied', transaction: { key: 'action-charge' } } as never; },
    });
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ kind: 'action', actionSlug: 'text' });
    expect(charges[0]).toHaveProperty('eventKey');
    expect(charges[0]).not.toMatchObject({ microSparks: 30_000_000 });
  });

  test('charges outcome-priced work only after canonical code establishes a cache miss', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    const order: string[] = [];
    const options = {
      input: { query: 'Japan' }, idempotencyKey: 'request', recorder: async () => {}, hash: async (value: string) => value.includes('outcomeKey') ? 'b'.repeat(64) : 'a'.repeat(64),
      charge: async (_userKey: string, input: Record<string, unknown>) => { order.push('charge'); return { status: 'applied', transaction: { key: 'charge-1', eventKey: input.eventKey } } as never; },
    };
    await observeToolExecution('place.guide.find', context, async () => { order.push('cache-hit'); return 'cached'; }, options);
    await observeToolExecution('place.guide.find', context, async () => { await chargeToolOutcome('JP:japan'); order.push('generate'); return 'generated'; }, options);
    expect(order).toEqual(['cache-hit', 'charge', 'generate']);
  });

  test('refunds an applied outcome charge when generation fails', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    let refundInput: Record<string, unknown> | undefined;
    await expect(observeToolExecution('place.find-city', context, async () => { await chargeToolOutcome('JP:tokyo'); throw new Error('generation failed'); }, {
      input: { city: 'Tokyo' }, idempotencyKey: 'request', recorder: async () => {}, hash: async () => 'c'.repeat(64),
      charge: async () => ({ status: 'applied', transaction: { key: 'outcome-charge' } }) as never,
      refund: async (_userKey, input) => { refundInput = input; return { status: 'applied', transaction: { key: 'refund-1' } } as never; },
    })).rejects.toThrow('generation failed');
    expect(refundInput).toMatchObject({ microSparks: 5_000_000, idempotencyKey: 'refund:outcome-charge', chargeTransactionKey: 'outcome-charge' });
  });

  test('keeps accepted durable outcomes and refunds only unfinished sibling outcomes', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    const completed: string[] = [], refunded: string[] = [];
    let sequence = 0;
    await expect(observeToolExecution('place.find-children', context, async () => {
      const accepted = await chargeToolOutcome('JP:tokyo');
      if (accepted) await markToolOutcomeAccepted(accepted);
      await chargeToolOutcome('JP:osaka');
      throw new Error('Osaka generation failed');
    }, {
      input: {}, idempotencyKey: 'children-request', recorder: async () => {}, hash: async () => `${++sequence}`.padStart(64, 'a').slice(-64),
      charge: async (_userKey, input) => ({ status: 'applied', claimOwner: `owner-${sequence}`, transaction: { key: `charge-${sequence}`, eventKey: input.eventKey } }) as never,
      complete: async (_userKey, executionIdentity) => { completed.push(executionIdentity); return true; },
      refund: async (_userKey, input) => { refunded.push(input.chargeTransactionKey); return { status: 'applied', transaction: { key: 'refund' } } as never; },
    })).rejects.toThrow('Osaka generation failed');
    expect(completed).toHaveLength(1);
    expect(refunded).toEqual(['charge-5']);
  });

  test('surfaces refund failure without losing the execution error', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    const workError = new Error('work failed'), refundError = new Error('refund failed');
    try {
      await observeToolExecution('book.create', context, async () => { throw workError; }, {
        input: {}, idempotencyKey: 'request', recorder: async () => {}, id: () => 'event-1', hash: async () => 'c'.repeat(64),
        charge: async (_userKey, input) => ({ status: 'applied', transaction: { key: 'charge-1', eventKey: input.eventKey } }) as never,
        refund: async () => { throw refundError; },
      });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(SparkRefundError);
      expect((error as SparkRefundError).executionError).toBe(workError);
      expect((error as SparkRefundError).cause).toBe(refundError);
    }
  });

  test('does not refund a replayed successful debit when repeated work fails', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    let refunds = 0;
    await expect(observeToolExecution('book.create', context, async () => { throw new Error('repeat failed'); }, {
      input: {}, idempotencyKey: 'request', recorder: async () => {}, hash: async () => 'd'.repeat(64),
      charge: async () => ({ status: 'replayed', transaction: { key: 'prior', eventKey: 'prior-event' } }) as never,
      refund: async () => { refunds += 1; return {} as never; },
    })).rejects.toThrow('repeat failed');
    expect(refunds).toBe(0);
  });

  test('does not run a concurrent fixed operation while its durable lease is pending', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    let work = 0, refunds = 0;
    await expect(observeToolExecution('book.create', context, async () => { work += 1; }, {
      input: {}, idempotencyKey: 'pending-request', recorder: async () => {},
      charge: async () => ({ status: 'pending', transaction: { key: 'existing-charge', eventKey: 'existing-event' } }) as never,
      refund: async () => { refunds += 1; return {} as never; },
    })).rejects.toBeInstanceOf(SparkExecutionPendingError);
    expect({ work, refunds }).toEqual({ work: 0, refunds: 0 });
  });

  test('charges a later successful retry after the failed attempt was refunded', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    let charges = 0, refunds = 0;
    const options = {
      input: {}, idempotencyKey: 'retry-request', recorder: async () => {},
      charge: async (_userKey: string, input: Record<string, unknown>) => { charges += 1; return { status: 'applied', transaction: { key: `charge-${charges}`, eventKey: input.eventKey } } as never; },
      refund: async () => { refunds += 1; return { status: 'applied', transaction: { key: 'refund-1' } } as never; },
    };
    await expect(observeToolExecution('book.create', context, async () => { throw new Error('transient'); }, options)).rejects.toThrow('transient');
    await expect(observeToolExecution('book.create', context, async () => 'created', options)).resolves.toBe('created');
    expect({ charges, refunds }).toEqual({ charges: 2, refunds: 1 });
  });

  test('keeps nested tool charges independent by including each slug in its execution identity', async () => {
    const context = { organizationKey: 'organization-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userOrganization: { key: 'member-1', organizationId: 'organization-1', userId: 'user-1', status: 'active' } } } as never;
    const identities: string[] = [];
    const charge = async (_userKey: string, input: Record<string, unknown>) => { identities.push(input.executionIdentity as string); return { status: 'applied', transaction: { key: `charge-${identities.length}`, eventKey: input.eventKey } } as never; };
    await observeToolExecution('book.create', context, () => observeToolExecution('highlight.create', context, async () => 'ok', { input: {}, idempotencyKey: 'same', recorder: async () => {}, charge }), { input: {}, idempotencyKey: 'same', recorder: async () => {}, charge });
    expect(identities).toHaveLength(2);
    expect(new Set(identities).size).toBe(2);
  });
});
