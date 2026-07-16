import { describe, expect, test } from 'bun:test';
import { assertToolAllowedByGuardrails, GuardrailViolationError, guardrailSchema, isToolAllowedByGuardrails } from './index';
import { newId } from '@/lib/ids';

const scopeOne = newId();
const scopeTwo = newId();

describe('guardrail schema', () => {
  test('contains ONLY scopeId', () => {
    expect(guardrailSchema.parse({ scopeId: scopeOne })).toEqual({ scopeId: scopeOne });
    expect(() => guardrailSchema.parse({ scopeId: scopeOne, name: 'x' })).toThrow();
    expect(() => guardrailSchema.parse({ scopeId: '' })).toThrow();
    expect(() => guardrailSchema.parse({})).toThrow();
  });
});

describe('guardrail evaluation', () => {
  const scopedTool = { id: 'ask.answer', scopeId: scopeOne };
  const otherScopedTool = { id: 'image.create', scopeId: scopeTwo };
  const unscopedTool = { id: 'reason.solve', scopeId: null };

  test('an agent with no guardrails may use any tool', () => {
    expect(isToolAllowedByGuardrails([], scopedTool)).toBe(true);
    expect(isToolAllowedByGuardrails([], unscopedTool)).toBe(true);
  });

  test('guardrails allow-list tools by scope', () => {
    const guardrails = [{ scopeId: scopeOne }];
    expect(isToolAllowedByGuardrails(guardrails, scopedTool)).toBe(true);
    expect(isToolAllowedByGuardrails(guardrails, otherScopedTool)).toBe(false);
  });

  test('a guardrailed agent may use globally unscoped tools', () => {
    expect(isToolAllowedByGuardrails([{ scopeId: scopeOne }], unscopedTool)).toBe(true);
  });

  test('assert throws a typed violation with the reason', () => {
    expect(() => assertToolAllowedByGuardrails('agent.x', [{ scopeId: scopeOne }], otherScopedTool)).toThrow(
      GuardrailViolationError,
    );
    expect(() => assertToolAllowedByGuardrails('agent.x', [], scopedTool)).not.toThrow();
  });
});
