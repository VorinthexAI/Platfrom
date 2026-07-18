import { z } from 'zod';
import { actionIdSchema } from '@/lib/ai/actions/types';
import { organizationKeySchema, persistedKeySchema } from '@/lib/ai/shared/ids';

export const ARTIFACTS_COLLECTION = 'artifacts';
export const ARTIFACT_SNAPSHOTS_COLLECTION = 'artifactSnapshots';
export const ARTIFACT_DEPENDENCIES_COLLECTION = 'artifactDependencies';

export const ARTIFACT_LAYOUTS = ['tree', 'cluster', 'galaxy', 'timeline', 'hierarchy', 'radial', 'force', 'grid', 'flow', 'orbit', 'layered', 'manual'] as const;
export const ARTIFACT_THEMES = ['obsidian', 'chrome', 'wireframe', 'blueprint', 'neural', 'holographic', 'minimal', 'monochrome'] as const;
export const ARTIFACT_TEXTURES = ['chrome-core', 'smoked-glass', 'brushed-silver', 'matte-graphite', 'neural-glow', 'holographic-glass', 'blueprint-grid', 'none'] as const;
export const ARTIFACT_NODE_KINDS = ['organization', 'scope', 'member', 'agent', 'artifact', 'metric', 'event'] as const;

export const artifactLayoutSchema = z.enum(ARTIFACT_LAYOUTS);
export const artifactThemeSchema = z.enum(ARTIFACT_THEMES);
export const artifactTextureSchema = z.enum(ARTIFACT_TEXTURES);
export const artifactNodeKindSchema = z.enum(ARTIFACT_NODE_KINDS);
export const artifactModeSchema = z.enum(['live', 'snapshot']);
export const artifactNodeStateSchema = z.enum(['default', 'active', 'archived', 'warning']);

const safeIdentifierSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
  .refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value), 'Unsafe identifier');
const safePathSegmentSchema = safeIdentifierSchema;
export const artifactPathSchema = z.array(safePathSegmentSchema).max(20).default([]);

export const nodeRefSchema = z.object({ type: z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9]*$/), key: persistedKeySchema }).strict();
export const sceneNodeRefSchema = z.object({ nodeType: nodeRefSchema.shape.type, nodeKey: nodeRefSchema.shape.key }).strict();

const jsonScalarSchema = z.union([z.string().max(4_000), z.number().finite(), z.boolean(), z.null()]);
export type ArtifactLiteral = z.infer<typeof jsonScalarSchema> | ArtifactLiteral[] | { [key: string]: ArtifactLiteral };
export const artifactLiteralSchema: z.ZodType<ArtifactLiteral> = z.lazy(() => z.union([
  jsonScalarSchema,
  z.array(artifactLiteralSchema).max(500),
  z.record(safeIdentifierSchema, artifactLiteralSchema).refine((value) => Object.keys(value).length <= 150, 'Object is too large'),
]));

export const queryVariableSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: artifactLiteralSchema }).strict(),
  z.object({ kind: z.literal('binding'), binding: safeIdentifierSchema }).strict(),
  z.object({ kind: z.literal('context'), value: z.enum(['organizationKey', 'scopeKey']) }).strict(),
]);

export const artifactBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), ref: nodeRefSchema, path: artifactPathSchema.optional() }).strict(),
  z.object({
    kind: z.literal('query'),
    queryId: z.string().trim().min(1).max(120).regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/),
    variables: z.record(safeIdentifierSchema, queryVariableSchema).default({}),
    path: artifactPathSchema.optional(),
  }).strict(),
  z.object({ kind: z.literal('artifact'), artifactKey: z.string().cuid(), path: artifactPathSchema.optional() }).strict(),
]);
export type ArtifactBinding = z.infer<typeof artifactBindingSchema>;

export const artifactNodeAppearanceSchema = z.object({
  shape: z.enum(['sphere', 'cube', 'ring', 'plane']).optional(),
  texture: artifactTextureSchema.optional(),
  scale: z.number().finite().min(0.2).max(8).optional(),
}).strict();

export const artifactGraphNodeSchema = z.object({
  binding: safeIdentifierSchema,
  kind: artifactNodeKindSchema,
  labelPath: artifactPathSchema.optional(),
  statePath: artifactPathSchema.optional(),
  weightPath: artifactPathSchema.optional(),
  appearance: artifactNodeAppearanceSchema.optional(),
}).strict();

export const artifactGraphEdgeSchema = z.object({
  from: safeIdentifierSchema,
  to: safeIdentifierSchema,
  relation: z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9-]*$/),
  directed: z.boolean().default(true),
}).strict();

const manualPositionSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const artifactViewSchema = z.object({
  layout: artifactLayoutSchema,
  theme: artifactThemeSchema,
  camera: z.enum(['perspective', 'orthographic']).default('perspective'),
  textures: z.record(artifactNodeKindSchema, artifactTextureSchema).default({}),
  spacing: z.number().finite().min(0.25).max(10).default(1),
  positions: z.record(z.string().min(1).max(300), manualPositionSchema).optional(),
}).strict().superRefine((view, ctx) => {
  if (view.layout === 'manual' && !view.positions) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['positions'], message: 'Manual layout requires positions' });
  if (view.layout !== 'manual' && view.positions) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['positions'], message: 'Only manual layout may persist positions' });
});

export const artifactActionSchema = z.object({
  actionId: actionIdSchema,
  label: z.string().trim().min(1).max(80),
  input: z.record(safeIdentifierSchema, queryVariableSchema).default({}),
}).strict();

export const artifactDefinitionSchema = z.object({
  version: z.literal(1),
  mode: artifactModeSchema,
  root: safeIdentifierSchema,
  nodes: z.record(safeIdentifierSchema, artifactGraphNodeSchema).refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 100, 'Artifact requires 1-100 semantic node groups'),
  edges: z.array(artifactGraphEdgeSchema).max(300),
  bindings: z.record(safeIdentifierSchema, artifactBindingSchema).refine((value) => Object.keys(value).length <= 200, 'Too many bindings'),
  view: artifactViewSchema,
  actions: z.record(safeIdentifierSchema, artifactActionSchema).optional(),
}).strict().superRefine((definition, ctx) => {
  const nodeAliases = new Set(Object.keys(definition.nodes));
  const bindingAliases = new Set(Object.keys(definition.bindings));
  if (!nodeAliases.has(definition.root)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['root'], message: 'Root must reference a semantic node group' });
  for (const [alias, node] of Object.entries(definition.nodes)) if (!bindingAliases.has(node.binding)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', alias, 'binding'], message: `Unknown binding alias: ${node.binding}` });
  for (const [index, edge] of definition.edges.entries()) {
    if (!nodeAliases.has(edge.from)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['edges', index, 'from'], message: `Unknown node group: ${edge.from}` });
    if (!nodeAliases.has(edge.to)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['edges', index, 'to'], message: `Unknown node group: ${edge.to}` });
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visitBinding = (alias: string) => {
    if (visiting.has(alias)) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bindings', alias], message: `Binding cycle detected at ${alias}` }); return; }
    if (visited.has(alias)) return;
    visiting.add(alias);
    const binding = definition.bindings[alias];
    if (binding?.kind === 'query') for (const variable of Object.values(binding.variables)) if (variable.kind === 'binding') {
      if (!bindingAliases.has(variable.binding)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bindings', alias, 'variables'], message: `Unknown binding alias: ${variable.binding}` });
      else visitBinding(variable.binding);
    }
    visiting.delete(alias); visited.add(alias);
  };
  bindingAliases.forEach(visitBinding);
});
export type ArtifactDefinition = z.infer<typeof artifactDefinitionSchema>;

export const artifactSchema = z.object({
  key: z.string().cuid(), organizationKey: organizationKeySchema, scopeKey: z.string().cuid(), name: z.string().trim().min(1).max(160),
  definition: artifactDefinitionSchema, schemaVersion: z.literal(1), snapshotKey: z.string().cuid().nullable().default(null),
  createdByAgentRunKey: z.string().cuid().nullable().default(null), createdByUserOrganizationKey: persistedKeySchema.nullable().default(null),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict().superRefine((artifact, ctx) => {
  if (artifact.definition.mode === 'snapshot' && !artifact.snapshotKey) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['snapshotKey'], message: 'Snapshot artifacts require a snapshotKey' });
  if (artifact.definition.mode === 'live' && artifact.snapshotKey) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['snapshotKey'], message: 'Live artifacts cannot reference a snapshot' });
});
export type Artifact = z.infer<typeof artifactSchema>;

export const semanticGraphNodeSchema = z.object({
  id: z.string().min(1).max(400), ref: sceneNodeRefSchema, group: safeIdentifierSchema, kind: artifactNodeKindSchema,
  label: z.string().trim().min(1).max(240), state: artifactNodeStateSchema, weight: z.number().finite().min(0).max(1_000).default(1),
  parentRef: sceneNodeRefSchema.nullable().default(null), clusterId: z.string().max(240).nullable().default(null),
  appearance: artifactNodeAppearanceSchema.optional(), details: artifactLiteralSchema,
}).strict();
export type SemanticGraphNode = z.infer<typeof semanticGraphNodeSchema>;

export const semanticGraphEdgeSchema = z.object({ id: z.string().min(1).max(900), from: z.string(), to: z.string(), relation: z.string(), directed: z.boolean() }).strict();
export type SemanticGraphEdge = z.infer<typeof semanticGraphEdgeSchema>;

export const resolvedArtifactGraphSchema = z.object({ nodes: z.array(semanticGraphNodeSchema).max(5_000), edges: z.array(semanticGraphEdgeSchema).max(20_000) }).strict();
export type ResolvedArtifactGraph = z.infer<typeof resolvedArtifactGraphSchema>;

export const artifactSnapshotSchema = z.object({
  key: z.string().cuid(), artifactKey: z.string().cuid(), graph: resolvedArtifactGraphSchema,
  revisions: z.record(z.string(), z.string()), createdAt: z.string().datetime(),
}).strict();
export type ArtifactSnapshot = z.infer<typeof artifactSnapshotSchema>;

export const artifactDependencySchema = z.object({
  key: z.string().cuid(), artifactKey: z.string().cuid(), organizationKey: organizationKeySchema, scopeKey: z.string().cuid(),
  dependencyType: z.enum(['node', 'query', 'artifact', 'scope', 'organization']), nodeType: z.string().nullable().default(null),
  nodeKey: persistedKeySchema.nullable().default(null), queryId: z.string().nullable().default(null), referencedArtifactKey: z.string().cuid().nullable().default(null),
  createdAt: z.string().datetime(),
}).strict();
export type ArtifactDependency = z.infer<typeof artifactDependencySchema>;
