import { describe, expect, test } from 'bun:test';
import {
  ALIAS_PREFIXES,
  ALIAS_ROLES,
  ALIAS_SLUG_PREFIX_SPACE,
  WELCOME_LINES,
  generateAlias,
  generateAliasSlug,
  pickWelcomeLine,
} from './alias';

describe('alias word lists', () => {
  test('has exactly 10000 unique prefixes', () => {
    expect(ALIAS_PREFIXES.length).toBe(10000);
    expect(new Set(ALIAS_PREFIXES.map((word) => word.toLowerCase())).size).toBe(10000);
  });

  test('has exactly 10000 unique roles', () => {
    expect(ALIAS_ROLES.length).toBe(10000);
    expect(new Set(ALIAS_ROLES.map((word) => word.toLowerCase())).size).toBe(10000);
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

describe('generateAliasSlug', () => {
  test('builds four-letter prefixed alias slugs', () => {
    expect(generateAliasSlug('Orbit Surfer', 'usr_abc123')).toMatch(/^[a-z]{4}-orbit-surfer$/);
  });

  test('is deterministic and changes by attempt', () => {
    const first = generateAliasSlug('Nova Cartographer', 'usr_abc123');
    expect(first).toBe(generateAliasSlug('Nova Cartographer', 'usr_abc123'));
    expect(generateAliasSlug('Nova Cartographer', 'usr_abc123', 1)).not.toBe(first);
  });

  test('allocates 100000 users with the same alias by retrying prefixes', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 100_000; index += 1) {
      let slug: string | null = null;
      for (let attempt = 0; attempt < ALIAS_SLUG_PREFIX_SPACE; attempt += 1) {
        const candidate = generateAliasSlug('Orbit Surfer', `usr_${index}`, attempt);
        if (!seen.has(candidate)) {
          slug = candidate;
          seen.add(candidate);
          break;
        }
      }
      expect(slug).not.toBeNull();
    }
    expect(ALIAS_SLUG_PREFIX_SPACE).toBe(456_976);
    expect(seen.size).toBe(100_000);
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
