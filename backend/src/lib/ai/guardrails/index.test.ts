import { describe, expect, test } from 'bun:test';
import { assertToolAllowedByGuardrails, GuardrailViolationError, guardrailSchema, isToolAllowedByGuardrails } from './index';

describe('guardrail schema', () => {
  test('contains ONLY scopeId', () => {
    expect(guardrailSchema.parse({ scopeId: 'scope1' })).toEqual({ scopeId: 'scope1' });
    expect(() => guardrailSchema.parse({ scopeId: 'scope1', name: 'x' })).toThrow();
    expect(() => guardrailSchema.parse({ scopeId: '' })).toThrow();
    expect(() => guardrailSchema.parse({})).toThrow();
  });
});

describe('guardrail evaluation', () => {
  const scopedTool = { id: 'chat.reply', scopeId: 'scope1' };
  const otherScopedTool = { id: 'image.create', scopeId: 'scope2' };
  const unscopedTool = { id: 'reason.solve', scopeId: null };

  test('an agent with no guardrails may use any tool', () => {
    expect(isToolAllowedByGuardrails([], scopedTool)).toBe(true);
    expect(isToolAllowedByGuardrails([], unscopedTool)).toBe(true);
  });

  test('guardrails allow-list tools by scope', () => {
    const guardrails = [{ scopeId: 'scope1' }];
    expect(isToolAllowedByGuardrails(guardrails, scopedTool)).toBe(true);
    expect(isToolAllowedByGuardrails(guardrails, otherScopedTool)).toBe(false);
  });

  test('a guardrailed agent may not use unscoped tools', () => {
    expect(isToolAllowedByGuardrails([{ scopeId: 'scope1' }], unscopedTool)).toBe(false);
  });

  test('assert throws a typed violation with the reason', () => {
    expect(() => assertToolAllowedByGuardrails('agent.x', [{ scopeId: 'scope1' }], otherScopedTool)).toThrow(
      GuardrailViolationError,
    );
    expect(() => assertToolAllowedByGuardrails('agent.x', [], scopedTool)).not.toThrow();
  });
});
