import { z } from 'zod';

/**
 * SKILL.md — the on-disk format an agent skill is authored in: YAML-lite
 * frontmatter carrying `name` and `description`, followed by the markdown
 * instruction body that becomes the agent's `skill` text.
 *
 * ```markdown
 * ---
 * name: Assistant
 * description: General-purpose helper.
 * ---
 * Answer precisely. Cite sources when you browse.
 * ```
 */
export const agentSkillSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    instructions: z.string().min(1),
  })
  .strict();

export type AgentSkill = z.infer<typeof agentSkillSchema>;

/** Serializes a skill into canonical SKILL.md text (inverse of {@link parseSkillMarkdown}). */
export function compileSkillMarkdown(skill: AgentSkill): string {
  const parsed = agentSkillSchema.parse(skill);
  return ['---', `name: ${parsed.name}`, `description: ${parsed.description}`, '---', '', parsed.instructions.trim(), ''].join('\n');
}

/**
 * Parses SKILL.md text. Only the two known frontmatter fields are read —
 * this is deliberately not a YAML parser; unknown frontmatter lines are a
 * validation error rather than silently ignored.
 */
export function parseSkillMarkdown(markdown: string): AgentSkill {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error('SKILL.md must start with a ----delimited frontmatter block');
  const [, frontmatter, body] = match;

  const fields: Record<string, string> = {};
  for (const line of (frontmatter ?? '').split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const separator = line.indexOf(':');
    if (separator === -1) throw new Error(`Invalid SKILL.md frontmatter line: ${line}`);
    const field = line.slice(0, separator).trim();
    if (field !== 'name' && field !== 'description') {
      throw new Error(`Unknown SKILL.md frontmatter field: ${field}`);
    }
    fields[field] = line.slice(separator + 1).trim();
  }

  return agentSkillSchema.parse({
    name: fields.name ?? '',
    description: fields.description ?? '',
    instructions: (body ?? '').trim(),
  });
}
