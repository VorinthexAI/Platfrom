import { z } from 'zod';
import { maxTenWordsSchema } from '@/lib/ai/agent-runs';
import { sourceSelectionSchema } from '@/lib/ai/agent-run-sources';

export const GENESIS_STEP_SLUGS = [
  'understand-request',
  'inspect-scope',
  'inspect-existing-agents',
  'inspect-existing-skills',
  'inspect-existing-tools',
  'design-agent-identity',
  'design-skill-composition',
  'select-tools',
  'validate-permissions',
  'validate-references',
  'validate-novelty',
  'produce-agent-manifest',
] as const;

export const genesisStepSlugSchema = z.enum(GENESIS_STEP_SLUGS);
export type GenesisStepSlug = z.infer<typeof genesisStepSlugSchema>;

export const cuidSchema = z.string().cuid();
export const kebabSlugSchema = z.string().trim().min(1).max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must use lowercase kebab-case');

export const genesisMetadataSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
  reason: maxTenWordsSchema,
  score: z.number().min(0).max(1),
}).strict();

export const genesisAgentCreateSchema = z.object({
  operation: z.literal('create'),
  slug: kebabSlugSchema,
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  scopeKey: cuidSchema,
  explorationRate: z.number().min(0).max(1).default(0.2),
}).strict();

export const genesisAgentReuseSchema = z.object({
  operation: z.literal('reuse'),
  agentKey: cuidSchema,
}).strict();

export const genesisAgentOperationSchema = z.discriminatedUnion('operation', [
  genesisAgentCreateSchema,
  genesisAgentReuseSchema,
]);

export const genesisSkillReuseSchema = z.object({
  operation: z.literal('reuse'),
  skillKey: cuidSchema,
  priority: z.number().int().nonnegative(),
}).strict();

export const genesisSkillCreateSchema = z.object({
  operation: z.literal('create'),
  slug: kebabSlugSchema,
  name: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(160),
  definition: z.string().trim().min(1),
  priority: z.number().int().nonnegative(),
}).strict();

export const genesisSkillOperationSchema = z.discriminatedUnion('operation', [
  genesisSkillReuseSchema,
  genesisSkillCreateSchema,
]);

export const genesisToolAttachSchema = z.object({
  operation: z.literal('attach'),
  toolKey: cuidSchema,
  reason: z.string().trim().min(1).max(500),
}).strict();

export const genesisSkillReferenceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('existing'), skillKey: cuidSchema }).strict(),
  z.object({ type: z.literal('created'), skillSlug: kebabSlugSchema }).strict(),
]);

export const genesisManifestValidationSchema = z.object({
  scopeExists: z.boolean(),
  agentIsUnique: z.boolean(),
  allSkillsResolved: z.boolean(),
  allToolsResolved: z.boolean(),
  permissionsValid: z.boolean(),
  noveltyValidated: z.boolean(),
  readyToPersist: z.boolean(),
  missingToolSlugs: z.array(kebabSlugSchema).default([]),
  warnings: z.array(z.string().trim().min(1).max(500)).default([]),
}).strict();

export const genesisCreationManifestSchema = z.object({
  metadata: genesisMetadataSchema,
  agent: genesisAgentOperationSchema,
  skills: z.array(genesisSkillOperationSchema).min(1),
  agentSkills: z.array(z.object({
    skillRef: genesisSkillReferenceSchema,
    priority: z.number().int().nonnegative(),
  }).strict()).min(1),
  agentTools: z.array(genesisToolAttachSchema),
  steps: z.array(genesisStepSlugSchema).min(1),
  validation: genesisManifestValidationSchema,
}).strict().superRefine((manifest, ctx) => {
  if (manifest.metadata.status === 'accepted' && !manifest.validation.readyToPersist) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['validation', 'readyToPersist'], message: 'Accepted manifests must be ready to persist' });
  }
  if (manifest.metadata.status === 'rejected' && manifest.validation.readyToPersist) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['validation', 'readyToPersist'], message: 'Rejected manifests cannot be ready to persist' });
  }
});

export type GenesisCreationManifest = z.infer<typeof genesisCreationManifestSchema>;

export const genesisSourcePolicySchema = z.object({
  requestedExplorationRate: z.number().min(0).max(1),
  effectiveExplorationRate: z.number().min(0).max(1),
  sourceCount: z.number().int().nonnegative(),
}).strict().superRefine((value, ctx) => {
  if (value.sourceCount === 0 && value.effectiveExplorationRate !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveExplorationRate'], message: 'No sources requires full exploration' });
  }
  if (value.sourceCount > 0 && value.effectiveExplorationRate !== value.requestedExplorationRate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveExplorationRate'], message: 'Sources must preserve requested exploration rate' });
  }
});

export const genesisRunInputSchema = z.object({
  organizationKey: cuidSchema,
  scopeKey: cuidSchema,
  genesisAgentKey: cuidSchema,
  currentTask: z.string().trim().min(1).max(20_000),
  requestedExplorationRate: z.number().min(0).max(1).optional(),
  sourceRefs: z.array(sourceSelectionSchema.extend({
    priority: z.number().int().nonnegative().default(100),
  }).strict()).default([]),
}).strict().superRefine((value, ctx) => {
  const seen = new Set<string>();
  value.sourceRefs.forEach((source, index) => {
    const identity = `${source.nodeType}/${source.nodeKey}`;
    if (seen.has(identity)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceRefs', index], message: 'Source references must be unique' });
    seen.add(identity);
  });
});

export type GenesisRunInput = z.input<typeof genesisRunInputSchema>;
export type ParsedGenesisRunInput = z.infer<typeof genesisRunInputSchema>;
