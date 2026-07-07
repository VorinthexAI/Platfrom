import { describe, expect, test } from 'bun:test';
import { ALIAS_PREFIXES, ALIAS_ROLES, WELCOME_LINES, generateAlias, pickWelcomeLine } from './alias';

describe('alias word lists', () => {
  test('has exactly 250 unique prefixes', () => {
    expect(ALIAS_PREFIXES.length).toBe(250);
    expect(new Set(ALIAS_PREFIXES).size).toBe(250);
  });

  test('has exactly 250 unique roles', () => {
    expect(ALIAS_ROLES.length).toBe(250);
    expect(new Set(ALIAS_ROLES).size).toBe(250);
  });
});

describe('generateAlias', () => {
  test('is deterministic for the same seed', () => {
    expect(generateAlias('usr_abc123')).toBe(generateAlias('usr_abc123'));
  });

  test('produces a "<Prefix> <Role>" pair from the lists', () => {
    const alias = generateAlias('usr_abc123');
    const [prefix, role] = alias.split(' ');
    expect(ALIAS_PREFIXES).toContain(prefix);
    expect(ALIAS_ROLES).toContain(role);
  });

  test('varies across different seeds', () => {
    const aliases = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(generateAlias));
    expect(aliases.size).toBeGreaterThan(1);
  });
});

describe('welcome lines', () => {
  test('has exactly 50 distinct lines with an {alias} placeholder', () => {
    expect(WELCOME_LINES.length).toBe(50);
    expect(new Set(WELCOME_LINES).size).toBe(50);
    for (const line of WELCOME_LINES) {
      expect(line).toContain('{alias}');
    }
  });

  test('pickWelcomeLine is deterministic and interpolates the alias', () => {
    const first = pickWelcomeLine('usr_abc123', 'Orbit Surfer');
    const second = pickWelcomeLine('usr_abc123', 'Orbit Surfer');
    expect(first).toBe(second);
    expect(first).toContain('Orbit Surfer');
    expect(first).not.toContain('{alias}');
  });
});
