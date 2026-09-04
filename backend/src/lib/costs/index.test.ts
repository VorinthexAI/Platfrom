import { describe, expect, test } from 'bun:test';
import {
  ACCOUNT_GRANT_MICRO_SPARKS,
  ACTION_METERED_TOOL_SLUGS,
  ACTION_COST_RULES,
  BYTES_PER_GIB,
  COST_RULE_PRECEDENCE,
  HOURS_PER_BILLING_MONTH,
  MICRO_SPARKS_PER_SPARK,
  TOOL_COST_RULES,
  TOOL_COST_POLICIES,
  FREE_TOOL_SLUGS,
  OUTCOME_METERED_TOOL_SLUGS,
  STORAGE_BYTE_MILLISECOND_DENOMINATOR,
  calculateByteHours,
  calculateStorageMicroSparks,
  formatMicroSparks,
  lookupCostRule,
  sparksToMicroSparks,
  storageCostFraction,
  storageCostMicroSparks,
  validateFixedCostRule,
  calculateActionCostMicroSparks,
  calculateToolCostMicroSparks,
  lookupToolCostPolicy,
} from './index';
import { PUBLIC_TOOL_DEFINITIONS } from '@/lib/ai/tools/tool-definitions';

describe('Spark costs', () => {
  test('converts decimal Sparks without floating-point arithmetic', () => {
    expect(MICRO_SPARKS_PER_SPARK).toBe(1_000_000);
    expect(ACCOUNT_GRANT_MICRO_SPARKS).toBe(100_000_000);
    expect(sparksToMicroSparks('1.000001')).toBe(1_000_001);
    expect(sparksToMicroSparks('0.5')).toBe(500_000);
    expect(formatMicroSparks(-1_500_010)).toBe('-1.50001');
    expect(() => sparksToMicroSparks('0.0000001')).toThrow();
    expect(() => sparksToMicroSparks(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => formatMicroSparks(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  test('calculates byte-hours and exact 24 Spark GiB-month pricing', () => {
    const month = calculateByteHours(BYTES_PER_GIB, HOURS_PER_BILLING_MONTH);
    const exact = storageCostFraction(month);
    expect(exact.numerator / exact.denominator).toBe(24_000_000n);
    expect(exact.numerator % exact.denominator).toBe(0n);
    expect(storageCostMicroSparks(month)).toBe(24_000_000);
    expect(storageCostMicroSparks(0)).toBe(0);
    expect(storageCostMicroSparks(1)).toBe(1);
    expect(() => calculateByteHours(-1, 1)).toThrow();
    expect(() => storageCostMicroSparks(BigInt(Number.MAX_SAFE_INTEGER) * BigInt(BYTES_PER_GIB) * BigInt(HOURS_PER_BILLING_MONTH))).toThrow('safe integer range');
  });

  test('keeps frozen canonical rule maps and validates all requested slugs', () => {
    expect(Object.isFrozen(TOOL_COST_RULES)).toBe(true);
    expect(Object.isFrozen(ACTION_COST_RULES)).toBe(true);
    expect(TOOL_COST_RULES['book.create']?.microSparks).toBe(100_000_000);
    expect(TOOL_COST_RULES['document.parse']?.microSparks).toBe(2_000_000);
    expect(Object.keys(ACTION_COST_RULES)).toEqual([]);
    expect(COST_RULE_PRECEDENCE).toEqual(['tool', 'action']);
    expect(lookupCostRule({ toolSlug: 'document.create', actionSlug: 'text' })).toBeNull();
    expect(() => lookupCostRule({ toolSlug: 'not-dotted' })).toThrow('Invalid dotted slug');
    expect(() => lookupCostRule({ actionSlug: 'Bad.slug' })).toThrow('Invalid action slug');
    expect(() => validateFixedCostRule({ type: 'fixed', microSparks: 0 })).toThrow();
    expect(() => validateFixedCostRule({ type: 'fixed', microSparks: 1.5 })).toThrow();
  });

  test('calculates fixed quantities and provider fallback prices', () => {
    expect(calculateToolCostMicroSparks('document.parse', { documents: [{}, {}, {}] })).toBe(6_000_000);
    expect(calculateToolCostMicroSparks('document.scan', { pages: [{}, {}] })).toBe(5_000_000);
    expect(calculateToolCostMicroSparks('image.caption', { images: ['a', 'b'] })).toBe(10_000_000);
    expect(calculateToolCostMicroSparks('web.search')).toBe(25_000_000);
    expect(calculateActionCostMicroSparks('text', { inputTokens: 1, outputTokens: 1 })).toBe(550);
    expect(calculateActionCostMicroSparks('text', { inputTokens: 0, outputTokens: 0 })).toBe(0);
    expect(calculateActionCostMicroSparks('text', { inputTokens: 20_000, outputTokens: 2_000 })).toBe(2_000_000);
    expect(calculateActionCostMicroSparks('speech', { inputTokens: 999, outputTokens: 1 })).toBe(10_000);
    expect(calculateActionCostMicroSparks('image', { inputTokens: 0, outputTokens: 0 }, { operation: 'generate', count: 3 })).toBe(90_000_000);
    expect(calculateActionCostMicroSparks('image', { inputTokens: 0, outputTokens: 0 }, { operation: 'describe', images: ['a', 'b'] })).toBe(10_000_000);
    expect(calculateActionCostMicroSparks('embed', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(0);
    expect(() => calculateActionCostMicroSparks('text', { inputTokens: 0.5, outputTokens: 0 })).toThrow('safe integer');
  });

  test('registers every fixed tool price against an actual unified tool', () => {
    const toolNames = PUBLIC_TOOL_DEFINITIONS.map(({ name }) => name);
    for (const slug of Object.keys(TOOL_COST_RULES)) expect(toolNames).toContain(slug);
    expect(lookupToolCostPolicy('place.guide.find')).toEqual({ mode: 'outcome', rule: TOOL_COST_RULES['place.guide.find'], paidOutcome: 'operation-completed' });
    expect(lookupToolCostPolicy('place.find-city')).toEqual({ mode: 'outcome', rule: TOOL_COST_RULES['place.find-city'], paidOutcome: 'operation-completed' });
    expect(lookupToolCostPolicy('place.find-children')).toEqual({ mode: 'outcome', rule: TOOL_COST_RULES['place.find-city'], paidOutcome: 'operation-completed' });
    expect(Object.hasOwn(TOOL_COST_RULES, 'place.reference.generate')).toBe(false);
    expect(Object.hasOwn(TOOL_COST_RULES, 'place.open')).toBe(false);
  });

  test('assigns exactly one explicit billing policy to every public tool', () => {
    const publicNames = PUBLIC_TOOL_DEFINITIONS.map(({ name }) => name).sort();
    expect(Object.keys(TOOL_COST_POLICIES).sort()).toEqual(publicNames);
    const assignments = [...FREE_TOOL_SLUGS, ...ACTION_METERED_TOOL_SLUGS, ...OUTCOME_METERED_TOOL_SLUGS, ...Object.keys(TOOL_COST_RULES).filter((slug) => !OUTCOME_METERED_TOOL_SLUGS.includes(slug as never))];
    expect(new Set(assignments).size).toBe(assignments.length);
    for (const slug of ['agents.core', 'app.enhance', 'app.search', 'app.translate', 'book.topic.suggest', 'conversation.message.send', 'document.rewrite', 'document.summarize', 'email.draft.create', 'feedback.create', 'image.create-visual-identity', 'image.ideas.create', 'inbox.sort', 'place.find', 'place.reference.generate', 'trip.guide.generate']) {
      expect(lookupToolCostPolicy(slug)).toEqual({ mode: 'action' });
    }
    expect(lookupToolCostPolicy('book.create')).toEqual({ mode: 'fixed', rule: TOOL_COST_RULES['book.create'], paidOutcome: 'queue-accepted' });
    expect(lookupToolCostPolicy('book.extend', { mode: 'preview' })).toEqual({ mode: 'action' });
    expect(lookupToolCostPolicy('highlight.create')).toEqual({ mode: 'fixed', rule: TOOL_COST_RULES['highlight.create'], paidOutcome: 'operation-completed' });
    for (const slug of ['place.open', 'place.update', 'document.find']) {
      expect(lookupToolCostPolicy(slug)).toEqual({ mode: 'free' });
    }
  });

  test('carries exact storage fractions across split calculations', () => {
    const splitAt = STORAGE_BYTE_MILLISECOND_DENOMINATOR / 3n;
    const first = calculateStorageMicroSparks(splitAt);
    const second = calculateStorageMicroSparks(STORAGE_BYTE_MILLISECOND_DENOMINATOR - splitAt + 1n, first.remainder);
    const combined = calculateStorageMicroSparks(STORAGE_BYTE_MILLISECOND_DENOMINATOR + 1n);
    expect(BigInt(first.amountMicroSparks) + BigInt(second.amountMicroSparks)).toBe(BigInt(combined.amountMicroSparks));
    expect(second.remainder).toBe(combined.remainder);
    expect(calculateStorageMicroSparks(0n, STORAGE_BYTE_MILLISECOND_DENOMINATOR - 1n).remainder).toBe((STORAGE_BYTE_MILLISECOND_DENOMINATOR - 1n).toString());
    expect(() => calculateStorageMicroSparks(0n, STORAGE_BYTE_MILLISECOND_DENOMINATOR)).toThrow('out of range');
  });

  test('rejects noncanonical storage integers and preserves safe decimal boundaries', () => {
    for (const value of ['', ' ', '+1', '-1', '01', '1.5']) expect(() => calculateStorageMicroSparks(value)).toThrow();
    expect(sparksToMicroSparks(formatMicroSparks(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(formatMicroSparks(Number.MIN_SAFE_INTEGER)).toBe('-9007199254.740991');
    expect(() => sparksToMicroSparks('9007199254.740992')).toThrow('safe integer range');
  });
});
