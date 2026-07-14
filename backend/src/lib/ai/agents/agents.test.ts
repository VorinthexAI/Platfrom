import { afterEach, describe, expect, test } from 'bun:test';
import { agentDefinitionSchema } from './types';
import { compileSkillMarkdown, parseSkillMarkdown } from './skill';
import { compileAgentSystemPrompt } from './prompt';
import {
  BUILT_IN_AGENTS,
  DuplicateAgentError,
  getAgent,
  listAgents,
  registerAgent,
  resetAgentRegistry,
  UnknownAgentError,
} from './registry';

afterEach(() => resetAgentRegistry());

describe('agent definition schema', () => {
  test('built-in agents are valid and unguardrailed', () => {
    for (const agent of BUILT_IN_AGENTS) {
      const parsed = agentDefinitionSchema.parse(agent);
      expect(parsed.guardrails).toEqual([]);
      expect(parsed.toolIds.length).toBeGreaterThan(0);
    }
  });

  test('rejects unknown tools, malformed ids, and extra fields', () => {
    const base = {
      id: 'test.agent',
      name: 'Test',
      description: 'Test agent',
      skill: 'Do the thing.',
      toolIds: ['ask.answer'],
    };
    expect(agentDefinitionSchema.parse(base).defaultStrategy).toBe('balanced');
    expect(() => agentDefinitionSchema.parse({ ...base, toolIds: ['not.a-tool'] })).toThrow();
    expect(() => agentDefinitionSchema.parse({ ...base, id: 'NotDotNotation' })).toThrow();
    expect(() => agentDefinitionSchema.parse({ ...base, providerId: 'openai' })).toThrow();
    // Guardrails contain only scopeId.
    expect(() => agentDefinitionSchema.parse({ ...base, guardrails: [{ scopeId: 's1', level: 'high' }] })).toThrow();
  });
});

describe('agent registry', () => {
  test('resolves built-ins and lists deterministically', () => {
    expect(getAgent('vorinthex.assistant').name).toBe('Vorinthex Assistant');
    const ids = listAgents().map((agent) => agent.id);
    expect(ids).toEqual([...ids].sort());
    expect(() => getAgent('missing.agent')).toThrow(UnknownAgentError);
  });

  test('registers runtime agents and rejects duplicates', () => {
    const scoped = registerAgent({
      id: 'org.support-agent',
      name: 'Support Agent',
      description: 'Scoped support agent',
      skill: 'Help with support tickets.',
      toolIds: ['ask.answer'],
      guardrails: [{ scopeId: 'scope_support' }],
    });
    expect(getAgent('org.support-agent')).toEqual(scoped);
    expect(() => registerAgent(scoped)).toThrow(DuplicateAgentError);
  });
});

describe('SKILL.md', () => {
  test('compiles and parses roundtrip', () => {
    const skill = { name: 'Assistant', description: 'General helper.', instructions: 'Answer precisely.\nCite sources.' };
    const markdown = compileSkillMarkdown(skill);
    expect(markdown.startsWith('---\nname: Assistant\ndescription: General helper.\n---')).toBe(true);
    expect(parseSkillMarkdown(markdown)).toEqual(skill);
  });

  test('rejects missing frontmatter and unknown fields', () => {
    expect(() => parseSkillMarkdown('just a body')).toThrow();
    expect(() => parseSkillMarkdown('---\nname: X\nmodel: gpt-5\n---\nbody')).toThrow();
    expect(() => parseSkillMarkdown('---\nname: X\n---\n')).toThrow();
  });
});

describe('prompt compilation', () => {
  test('is deterministic and assembles skill plus tool descriptions from the registries', () => {
    const agent = getAgent('vorinthex.assistant');
    const prompt = compileAgentSystemPrompt(agent);
    expect(compileAgentSystemPrompt(agent)).toBe(prompt);
    expect(prompt).toContain('# Vorinthex Assistant');
    expect(prompt).toContain('You are the Vorinthex assistant.');
    expect(prompt).toContain('## Available tools');
    expect(prompt).toContain('- ask.answer — Ask:');
    expect(prompt).toContain('(action core.ask:');
    // Providers and models never leak into prompts.
    expect(prompt).not.toContain('openai');
    expect(prompt).not.toContain('anthropic');
  });
});
