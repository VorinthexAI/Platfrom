import { db } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { checkoutHandoffSchema, type CheckoutHandoff } from './checkout-handoff-contracts';
import { z } from 'zod';

interface Cursor { next(): Promise<unknown> }
export interface CheckoutHandoffDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<Cursor> }

export interface CheckoutHandoffRepository {
  issue(handoff: CheckoutHandoff, now: string): Promise<'issued' | 'duplicate' | 'conflict'>;
  inspect(tokenHash: string, now: string): Promise<CheckoutHandoff | null>;
  claim(tokenHash: string, leaseKey: string, now: string, leaseExpiresAt: string): Promise<CheckoutHandoff | null>;
  consume(tokenHash: string, leaseKey: string, checkoutKey: string, now: string): Promise<CheckoutHandoff | null>;
  release(tokenHash: string, leaseKey: string, now: string): Promise<void>;
}

const parse = (value: unknown) => value ? checkoutHandoffSchema.parse(withArangoKey(value as Record<string, unknown>)) : null;

export function createArangoCheckoutHandoffRepository(database: CheckoutHandoffDatabase = db as unknown as CheckoutHandoffDatabase): CheckoutHandoffRepository {
  const repository: CheckoutHandoffRepository = {
    async issue(handoff, now) {
      const valid = checkoutHandoffSchema.parse(handoff);
      const cursor = await database.query(`
        UPSERT { issuanceKey: @issuanceKey }
          INSERT @handoff
          UPDATE {}
          IN checkoutHandoffs
        LET active = OLD != null && OLD.expiresAt > @now && OLD.consumedAt == null
        RETURN OLD == null ? "issued" : active && OLD.requestHash == @requestHash ? "duplicate" : "conflict"
      `, { issuanceKey: valid.issuanceKey, requestHash: valid.requestHash, now, handoff: toArangoDoc(valid) });
      return z.enum(['issued', 'duplicate', 'conflict']).parse(await cursor.next());
    },
    async inspect(tokenHash, now) {
      const cursor = await database.query('FOR handoff IN checkoutHandoffs FILTER handoff.tokenHash == @tokenHash && handoff.purpose == "payment-checkout" && handoff.expiresAt > @now && handoff.consumedAt == null LIMIT 1 RETURN handoff', { tokenHash, now });
      return parse(await cursor.next());
    },
    async claim(tokenHash, leaseKey, now, leaseExpiresAt) {
      const cursor = await database.query(`
        FOR handoff IN checkoutHandoffs
          FILTER handoff.tokenHash == @tokenHash && handoff.purpose == "payment-checkout" && handoff.expiresAt > @now && handoff.consumedAt == null
          FILTER handoff.claimLeaseKey == null || handoff.claimLeaseExpiresAt <= @now
          LIMIT 1
          UPDATE handoff WITH { claimLeaseKey: @leaseKey, claimLeaseExpiresAt: @leaseExpiresAt, updatedAt: @now } IN checkoutHandoffs
          RETURN NEW
      `, { tokenHash, leaseKey, now, leaseExpiresAt });
      return parse(await cursor.next());
    },
    async consume(tokenHash, leaseKey, checkoutKey, now) {
      const cursor = await database.query(`
        FOR handoff IN checkoutHandoffs
          FILTER handoff.tokenHash == @tokenHash && handoff.claimLeaseKey == @leaseKey && handoff.consumedAt == null
          LIMIT 1
          UPDATE handoff WITH { consumedAt: @now, checkoutKey: @checkoutKey, claimLeaseKey: null, claimLeaseExpiresAt: null, updatedAt: @now } IN checkoutHandoffs
          RETURN NEW
      `, { tokenHash, leaseKey, checkoutKey, now });
      return parse(await cursor.next());
    },
    async release(tokenHash, leaseKey, now) {
      await database.query('FOR handoff IN checkoutHandoffs FILTER handoff.tokenHash == @tokenHash && handoff.claimLeaseKey == @leaseKey && handoff.consumedAt == null UPDATE handoff WITH { claimLeaseKey: null, claimLeaseExpiresAt: null, updatedAt: @now } IN checkoutHandoffs', { tokenHash, leaseKey, now });
    },
  };
  return Object.freeze(repository);
}
