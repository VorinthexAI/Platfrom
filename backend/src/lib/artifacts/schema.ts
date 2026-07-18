import { z } from 'zod';
import { organizationKeySchema, persistedKeySchema } from '@/lib/ai/shared/ids';
import { actionIdSchema } from '@/lib/ai/actions/types';

export const ARTIFACTS_COLLECTION = 'artifacts';
export const ARTIFACT_SNAPSHOTS_COLLECTION = 'artifactSnapshots';
export const ARTIFACT_DEPENDENCIES_COLLECTION = 'artifactDependencies';

export const artifactRendererSchema = z.enum(['document', 'dashboard', 'table', 'graph', 'timeline', 'form']);
export const artifactModeSchema = z.enum(['live', 'snapshot']);
const safePathSegmentSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
  .refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value), 'Unsafe path segment');
export const artifactPathSchema = z.array(safePathSegmentSchema).max(20).default([]);

export const nodeRefSchema = z.object({
  type: z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9]*$/),
  key: persistedKeySchema,
}).strict();

export const fieldRefSchema = z.object({ node: nodeRefSchema, path: artifactPathSchema }).strict();

const jsonScalarSchema = z.union([z.string().max(4_000), z.number().finite(), z.boolean(), z.null()]);
export type ArtifactLiteral = z.infer<typeof jsonScalarSchema> | ArtifactLiteral[] | { [key: string]: ArtifactLiteral };
export const artifactLiteralSchema: z.ZodType<ArtifactLiteral> = z.lazy(() => z.union([
  jsonScalarSchema,
  z.array(artifactLiteralSchema).max(200),
  z.record(safePathSegmentSchema, artifactLiteralSchema).refine((value) => Object.keys(value).length <= 100, 'Literal object is too large'),
]));

export const artifactFormatSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('number'), locale: z.string().max(35).optional(), compact: z.boolean().default(false), maximumFractionDigits: z.number().int().min(0).max(20).optional() }).strict(),
  z.object({ type: z.literal('currency'), currency: z.string().regex(/^[A-Z]{3}$/), locale: z.string().max(35).optional(), compact: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal('percent'), locale: z.string().max(35).optional(), maximumFractionDigits: z.number().int().min(0).max(20).optional() }).strict(),
  z.object({ type: z.literal('date'), locale: z.string().max(35).optional(), dateStyle: z.enum(['short', 'medium', 'long', 'full']).default('medium') }).strict(),
  z.object({ type: z.literal('text'), prefix: z.string().max(100).optional(), suffix: z.string().max(100).optional() }).strict(),
]);

const bindingTransformSchema = z.enum(['identity', 'count', 'sum', 'average', 'first', 'last']);
const bindingBase = {
  path: artifactPathSchema.optional(),
  transform: bindingTransformSchema.optional(),
  format: artifactFormatSchema.optional(),
};

export const queryVariableSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: artifactLiteralSchema }).strict(),
  z.object({ kind: z.literal('binding'), binding: safePathSegmentSchema }).strict(),
  z.object({ kind: z.literal('context'), value: z.enum(['organizationKey', 'scopeKey']) }).strict(),
]);

export const artifactBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), ref: nodeRefSchema, ...bindingBase }).strict(),
  z.object({
    kind: z.literal('query'),
    queryId: z.string().trim().min(1).max(120).regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/),
    variables: z.record(safePathSegmentSchema, queryVariableSchema).default({}),
    ...bindingBase,
  }).strict(),
  z.object({ kind: z.literal('artifact'), artifactKey: z.string().cuid(), ...bindingBase }).strict(),
  z.object({ kind: z.literal('literal'), value: artifactLiteralSchema, format: artifactFormatSchema.optional() }).strict(),
]);

export type ArtifactBinding = z.infer<typeof artifactBindingSchema>;

export const artifactPresentationSchema = z.object({
  columns: z.number().int().min(1).max(12).optional(),
  span: z.number().int().min(1).max(12).optional(),
  tone: z.enum(['neutral', 'positive', 'warning', 'critical', 'accent']).optional(),
  align: z.enum(['start', 'center', 'end']).optional(),
  compact: z.boolean().optional(),
}).strict();

export type LayoutNode = {
  type: 'stack' | 'grid' | 'section' | 'heading' | 'text' | 'metric' | 'table' | 'graph' | 'timeline' | 'form' | 'artifact';
  key?: string;
  title?: string;
  binding?: string;
  presentation?: z.infer<typeof artifactPresentationSchema>;
  children?: LayoutNode[];
};

export const layoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() => z.object({
  type: z.enum(['stack', 'grid', 'section', 'heading', 'text', 'metric', 'table', 'graph', 'timeline', 'form', 'artifact']),
  key: safePathSegmentSchema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  binding: safePathSegmentSchema.optional(),
  presentation: artifactPresentationSchema.optional(),
  children: z.array(layoutNodeSchema).max(100).optional(),
}).strict());

export const artifactActionSchema = z.object({
  actionId: actionIdSchema,
  label: z.string().trim().min(1).max(80),
  input: z.record(safePathSegmentSchema, queryVariableSchema).default({}),
}).strict();

export const artifactDefinitionSchema = z.object({
  version: z.literal(1),
  mode: artifactModeSchema,
  renderer: artifactRendererSchema,
  layout: layoutNodeSchema,
  bindings: z.record(safePathSegmentSchema, artifactBindingSchema).refine((value) => Object.keys(value).length <= 200, 'Too many bindings'),
  actions: z.record(safePathSegmentSchema, artifactActionSchema).optional(),
}).strict().superRefine((definition, ctx) => {
  const aliases = new Set(Object.keys(definition.bindings));
  const visit = (node: LayoutNode) => {
    if (node.binding && !aliases.has(node.binding)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['layout'], message: `Unknown binding alias: ${node.binding}` });
    node.children?.forEach(visit);
  };
  visit(definition.layout);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visitBinding = (alias: string) => {
    if (visiting.has(alias)) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bindings', alias], message: `Binding cycle detected at ${alias}` }); return; }
    if (visited.has(alias)) return;
    visiting.add(alias);
    const binding = definition.bindings[alias];
    if (binding?.kind === 'query') {
      for (const variable of Object.values(binding.variables)) if (variable.kind === 'binding') {
        if (!aliases.has(variable.binding)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bindings', alias, 'variables'], message: `Unknown binding alias: ${variable.binding}` });
        else visitBinding(variable.binding);
      }
    }
    visiting.delete(alias); visited.add(alias);
  };
  aliases.forEach(visitBinding);
});

export type ArtifactDefinition = z.infer<typeof artifactDefinitionSchema>;

export const artifactSchema = z.object({
  key: z.string().cuid(),
  organizationKey: organizationKeySchema,
  scopeKey: z.string().cuid(),
  name: z.string().trim().min(1).max(160),
  definition: artifactDefinitionSchema,
  schemaVersion: z.literal(1),
  snapshotKey: z.string().cuid().nullable().default(null),
  createdByAgentRunKey: z.string().cuid().nullable().default(null),
  createdByUserOrganizationKey: persistedKeySchema.nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict().superRefine((artifact, ctx) => {
  if (artifact.definition.mode === 'snapshot' && !artifact.snapshotKey) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['snapshotKey'], message: 'Snapshot artifacts require a snapshotKey' });
  if (artifact.definition.mode === 'live' && artifact.snapshotKey) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['snapshotKey'], message: 'Live artifacts cannot reference a snapshot' });
});

export type Artifact = z.infer<typeof artifactSchema>;

export const artifactSnapshotSchema = z.object({
  key: z.string().cuid(), artifactKey: z.string().cuid(), values: z.record(z.string(), artifactLiteralSchema),
  revisions: z.record(z.string(), z.string()), createdAt: z.string().datetime(),
}).strict();
export type ArtifactSnapshot = z.infer<typeof artifactSnapshotSchema>;

export const artifactDependencySchema = z.object({
  key: z.string().cuid(), artifactKey: z.string().cuid(), organizationKey: organizationKeySchema, scopeKey: z.string().cuid(),
  dependencyType: z.enum(['node', 'query', 'artifact', 'scope', 'organization']),
  nodeType: z.string().nullable().default(null), nodeKey: persistedKeySchema.nullable().default(null),
  queryId: z.string().nullable().default(null), referencedArtifactKey: z.string().cuid().nullable().default(null),
  createdAt: z.string().datetime(),
}).strict();
export type ArtifactDependency = z.infer<typeof artifactDependencySchema>;
