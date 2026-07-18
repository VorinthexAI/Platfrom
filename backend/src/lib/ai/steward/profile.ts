import { DOMAIN_ACTION_SLUGS, type DomainActionSlug } from '@/lib/ai/domain-tools/schemas';

/**
 * Canonical capability bundle for an organization-administration agent.
 * This is a profile, not a seeded agent: Genesis may use it when the product
 * eventually exposes Steward creation. Runtime authority still belongs to the
 * initiating human and every operation passes through the local handler RBAC.
 */
export const ORGANIZATION_STEWARD_TOOL_SLUGS: readonly DomainActionSlug[] = [...DOMAIN_ACTION_SLUGS];

export const ORGANIZATION_STEWARD_SKILL = {
  slug: 'organization-steward',
  name: 'Organization Steward',
  title: 'Organization Administration',
  definition: `# Organization Steward

Interpret organization-administration requests and select the narrowest matching local tool.

## Operating rules

- Act only with the initiating human's effective organization and scope permissions.
- Never treat the agent, its prompt, or its tool grants as superuser authority.
- Resolve names, aliases, emails, slugs, paths, and keys within the active organization only.
- Never guess when a reference is ambiguous; return candidates and ask for precision.
- Use access evaluate and explain tools for authorization questions.
- Preview broad or destructive effects and require the tool's explicit confirmation fields.
- Never reveal credentials, provider secrets, tokens, or raw secret-bearing errors.
- Report the local handler result faithfully; do not claim a mutation succeeded before it commits.
`,
} as const;

type StewardToolCandidate = { key: string; slug: string; enabled: boolean; scopeKey: string | null };
type StewardSkillCandidate = { key: string; slug: string };
type StewardSkillOperation =
  | { operation: 'create'; slug: string; name: string; title: string; definition: string }
  | { operation: 'reuse'; skillKey: string };

/** Returns a stable rejection reason when a requested Steward would be incomplete. */
export function validateOrganizationStewardBindings(input: {
  scopeKey: string;
  tools: readonly StewardToolCandidate[];
  skills: readonly StewardSkillCandidate[];
  attachedToolKeys: readonly string[];
  skillOperations: readonly StewardSkillOperation[];
}): string | null {
  const toolKeysBySlug = new Map(input.tools.filter((tool) => tool.enabled && (tool.scopeKey === null || tool.scopeKey === input.scopeKey)).map((tool) => [tool.slug, tool.key]));
  const unavailable = ORGANIZATION_STEWARD_TOOL_SLUGS.filter((slug) => !toolKeysBySlug.has(slug));
  if (unavailable.length) return `Organization Steward tools are unavailable: ${unavailable.join(', ')}`;
  const attached = new Set(input.attachedToolKeys);
  const missing = ORGANIZATION_STEWARD_TOOL_SLUGS.filter((slug) => !attached.has(toolKeysBySlug.get(slug)!));
  if (missing.length) return `Organization Steward manifest is missing tools: ${missing.join(', ')}`;
  const hasCanonicalSkill = input.skillOperations.some((skill) => skill.operation === 'create'
    ? skill.slug === ORGANIZATION_STEWARD_SKILL.slug && skill.name === ORGANIZATION_STEWARD_SKILL.name && skill.title === ORGANIZATION_STEWARD_SKILL.title && skill.definition === ORGANIZATION_STEWARD_SKILL.definition
    : input.skills.some((existing) => existing.key === skill.skillKey && existing.slug === ORGANIZATION_STEWARD_SKILL.slug));
  return hasCanonicalSkill ? null : 'Organization Steward requires the canonical Organization Steward skill';
}
