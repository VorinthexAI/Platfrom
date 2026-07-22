import { z } from 'zod';
import { milestoneStatusSchema } from '@/lib/db/milestones.node';
import { taskPrioritySchema, taskStatusSchema } from '@/lib/db/tasks.node';

const key = z.string().cuid();
const text = z.string().trim().min(1).max(4_000);
const shortText = z.string().trim().min(1).max(255);
const atomic = z.boolean().default(true);
const batch = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item).min(1).max(100), atomic }).strict();
const keyed = (field: string) => z.object({ [field]: key }).strict();
const updateRequired = <T extends z.AnyZodObject>(schema: T, identity: string) => schema.refine((value) => Object.keys(value).some((field) => field !== identity), 'At least one update is required.');

const projectCreate = z.object({ scopeKey: key, name: shortText, description: text.optional() }).strict();
const projectUpdate = updateRequired(z.object({ projectKey: key, name: shortText.optional(), description: text.nullable().optional() }).strict(), 'projectKey');
const milestoneCreate = z.object({ projectKey: key, name: shortText, description: text.optional(), status: milestoneStatusSchema.default('planned'), startDate: z.string().date().optional(), endDate: z.string().date().optional(), order: z.number().int().nonnegative().default(0) }).strict();
const milestoneUpdate = updateRequired(z.object({ milestoneKey: key, name: shortText.optional(), description: text.nullable().optional(), status: milestoneStatusSchema.optional(), startDate: z.string().date().nullable().optional(), endDate: z.string().date().nullable().optional(), order: z.number().int().nonnegative().optional() }).strict(), 'milestoneKey');
const taskCreate = z.object({ milestoneKey: key, title: shortText, description: text.optional(), status: taskStatusSchema.default('todo'), priority: taskPrioritySchema.default('medium'), position: z.number().int().nonnegative().default(0) }).strict();
const taskUpdate = updateRequired(z.object({ taskKey: key, title: shortText.optional(), description: text.nullable().optional(), status: taskStatusSchema.optional(), priority: taskPrioritySchema.optional(), position: z.number().int().nonnegative().optional() }).strict(), 'taskKey');
const references = z.array(key).min(1).max(100);
const sourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project'), projectKeys: references }).strict(),
  z.object({ type: z.literal('milestone'), milestoneKeys: references }).strict(),
  z.object({ type: z.literal('task'), taskKeys: references }).strict(),
]);

export const momentumToolInputSchemas = {
  'project.create': batch(projectCreate),
  'project.find': z.object({ projectKeys: references }).strict(),
  'project.list': z.object({ scopeKey: key, includeArchived: z.boolean().default(false) }).strict(),
  'project.update': batch(projectUpdate),
  'project.rename': batch(z.object({ projectKey: key, name: shortText }).strict()),
  'project.move': batch(z.object({ projectKey: key, scopeKey: key }).strict()),
  'project.archive': batch(keyed('projectKey')),
  'project.restore': batch(keyed('projectKey')),
  'project.delete': batch(keyed('projectKey')),

  'milestone.create': batch(milestoneCreate),
  'milestone.find': z.object({ milestoneKeys: references }).strict(),
  'milestone.list': z.object({ projectKey: key, includeArchived: z.boolean().default(false) }).strict(),
  'milestone.update': batch(milestoneUpdate),
  'milestone.rename': batch(z.object({ milestoneKey: key, name: shortText }).strict()),
  'milestone.move': batch(z.object({ milestoneKey: key, projectKey: key, order: z.number().int().nonnegative().optional() }).strict()),
  'milestone.schedule': batch(z.object({ milestoneKey: key, startDate: z.string().date().nullable().optional(), endDate: z.string().date().nullable().optional() }).strict()),
  'milestone.change-status': batch(z.object({ milestoneKey: key, status: milestoneStatusSchema }).strict()),
  'milestone.complete': batch(keyed('milestoneKey')),
  'milestone.reopen': batch(keyed('milestoneKey')),
  'milestone.archive': batch(keyed('milestoneKey')),
  'milestone.restore': batch(keyed('milestoneKey')),
  'milestone.delete': batch(keyed('milestoneKey')),

  'task.create': batch(taskCreate),
  'task.find': z.object({ taskKeys: references }).strict(),
  'task.list': z.object({ projectKey: key, milestoneKey: key.optional(), includeArchived: z.boolean().default(false) }).strict(),
  'task.update': batch(taskUpdate),
  'task.rename': batch(z.object({ taskKey: key, title: shortText }).strict()),
  'task.move': batch(z.object({ taskKey: key, milestoneKey: key, position: z.number().int().nonnegative().optional() }).strict()),
  'task.reorder': batch(z.object({ taskKey: key, position: z.number().int().nonnegative() }).strict()),
  'task.change-status': batch(z.object({ taskKey: key, status: taskStatusSchema }).strict()),
  'task.complete': batch(keyed('taskKey')),
  'task.reopen': batch(keyed('taskKey')),
  'task.archive': batch(keyed('taskKey')),
  'task.restore': batch(keyed('taskKey')),
  'task.delete': batch(keyed('taskKey')),
  'task.summarize': batch(z.object({ taskKey: key, persist: z.boolean().default(false) }).strict()),
  'task.translate': batch(z.object({ taskKey: key, language: shortText, persist: z.boolean().default(false) }).strict()),
  'task.rewrite': batch(z.object({ taskKey: key, instruction: text, persist: z.boolean().default(false) }).strict()),

  'scope.project.search': z.object({ scopeKey: key, query: text, sources: z.array(sourceSchema).max(100).default([]), limit: z.number().int().min(1).max(100).default(20) }).strict(),
  'organization.project.search': z.object({ query: text, scopeKeys: z.array(key).max(100).default([]), sources: z.array(sourceSchema).max(100).default([]), limit: z.number().int().min(1).max(100).default(20) }).strict(),
} as const;

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) });
const keyProperty = { type: 'string', description: 'CUID resource key.' };
const items = (properties: Record<string, unknown>, required: string[]) => object({ items: { type: 'array', minItems: 1, maxItems: 100, items: object(properties, required) }, atomic: { type: 'boolean', default: true } }, ['items']);

const fieldSchemas: Record<string, unknown> = {
  projectKey: keyProperty, milestoneKey: keyProperty, taskKey: keyProperty, scopeKey: keyProperty,
  name: { type: 'string', minLength: 1, maxLength: 255 }, title: { type: 'string', minLength: 1, maxLength: 255 },
  description: { type: ['string', 'null'], minLength: 1, maxLength: 4_000 },
  status: { type: 'string' }, priority: { type: 'string', enum: taskPrioritySchema.options },
  position: { type: 'integer', minimum: 0 }, order: { type: 'integer', minimum: 0 },
  startDate: { type: ['string', 'null'], format: 'date' }, endDate: { type: ['string', 'null'], format: 'date' },
  language: { type: 'string', minLength: 1 }, instruction: { type: 'string', minLength: 1 }, persist: { type: 'boolean', default: false },
};
const mutationConfig: Record<string, { fields: string[]; required: string[] }> = {
  'project.create': { fields: ['scopeKey', 'name', 'description'], required: ['scopeKey', 'name'] },
  'project.update': { fields: ['projectKey', 'name', 'description'], required: ['projectKey'] },
  'project.rename': { fields: ['projectKey', 'name'], required: ['projectKey', 'name'] },
  'project.move': { fields: ['projectKey', 'scopeKey'], required: ['projectKey', 'scopeKey'] },
  'project.archive': { fields: ['projectKey'], required: ['projectKey'] }, 'project.restore': { fields: ['projectKey'], required: ['projectKey'] }, 'project.delete': { fields: ['projectKey'], required: ['projectKey'] },
  'milestone.create': { fields: ['projectKey', 'name', 'description', 'status', 'startDate', 'endDate', 'order'], required: ['projectKey', 'name'] },
  'milestone.update': { fields: ['milestoneKey', 'name', 'description', 'status', 'startDate', 'endDate', 'order'], required: ['milestoneKey'] },
  'milestone.rename': { fields: ['milestoneKey', 'name'], required: ['milestoneKey', 'name'] },
  'milestone.move': { fields: ['milestoneKey', 'projectKey', 'order'], required: ['milestoneKey', 'projectKey'] },
  'milestone.schedule': { fields: ['milestoneKey', 'startDate', 'endDate'], required: ['milestoneKey'] },
  'milestone.change-status': { fields: ['milestoneKey', 'status'], required: ['milestoneKey', 'status'] },
  'milestone.complete': { fields: ['milestoneKey'], required: ['milestoneKey'] }, 'milestone.reopen': { fields: ['milestoneKey'], required: ['milestoneKey'] }, 'milestone.archive': { fields: ['milestoneKey'], required: ['milestoneKey'] }, 'milestone.restore': { fields: ['milestoneKey'], required: ['milestoneKey'] }, 'milestone.delete': { fields: ['milestoneKey'], required: ['milestoneKey'] },
  'task.create': { fields: ['milestoneKey', 'title', 'description', 'status', 'priority', 'position'], required: ['milestoneKey', 'title'] },
  'task.update': { fields: ['taskKey', 'title', 'description', 'status', 'priority', 'position'], required: ['taskKey'] },
  'task.rename': { fields: ['taskKey', 'title'], required: ['taskKey', 'title'] },
  'task.move': { fields: ['taskKey', 'milestoneKey', 'position'], required: ['taskKey', 'milestoneKey'] },
  'task.reorder': { fields: ['taskKey', 'position'], required: ['taskKey', 'position'] },
  'task.change-status': { fields: ['taskKey', 'status'], required: ['taskKey', 'status'] },
  'task.complete': { fields: ['taskKey'], required: ['taskKey'] }, 'task.reopen': { fields: ['taskKey'], required: ['taskKey'] }, 'task.archive': { fields: ['taskKey'], required: ['taskKey'] }, 'task.restore': { fields: ['taskKey'], required: ['taskKey'] }, 'task.delete': { fields: ['taskKey'], required: ['taskKey'] },
  'task.summarize': { fields: ['taskKey', 'persist'], required: ['taskKey'] },
  'task.translate': { fields: ['taskKey', 'language', 'persist'], required: ['taskKey', 'language'] },
  'task.rewrite': { fields: ['taskKey', 'instruction', 'persist'], required: ['taskKey', 'instruction'] },
};
const jsonSchemas: Record<string, Record<string, unknown>> = {};
for (const [action, config] of Object.entries(mutationConfig)) {
  const properties = Object.fromEntries(config.fields.map((field) => [field, fieldSchemas[field]]));
  if (config.fields.includes('status')) properties.status = { type: 'string', enum: action.startsWith('milestone.') ? milestoneStatusSchema.options : taskStatusSchema.options };
  jsonSchemas[action] = items(properties, config.required);
  if (['project.update', 'milestone.update', 'task.update'].includes(action)) {
    const mutable = config.fields.filter((field) => !field.endsWith('Key'));
    const itemSchema = (jsonSchemas[action] as { properties: { items: { items: Record<string, unknown> } } }).properties.items.items;
    itemSchema.anyOf = mutable.map((field) => ({ required: [field] }));
  }
}
jsonSchemas['project.find'] = object({ projectKeys: { type: 'array', minItems: 1, maxItems: 100, items: keyProperty } }, ['projectKeys']);
jsonSchemas['milestone.find'] = object({ milestoneKeys: { type: 'array', minItems: 1, maxItems: 100, items: keyProperty } }, ['milestoneKeys']);
jsonSchemas['task.find'] = object({ taskKeys: { type: 'array', minItems: 1, maxItems: 100, items: keyProperty } }, ['taskKeys']);
jsonSchemas['project.list'] = object({ scopeKey: keyProperty, includeArchived: { type: 'boolean', default: false } }, ['scopeKey']);
jsonSchemas['milestone.list'] = object({ projectKey: keyProperty, includeArchived: { type: 'boolean', default: false } }, ['projectKey']);
jsonSchemas['task.list'] = object({ projectKey: keyProperty, milestoneKey: keyProperty, includeArchived: { type: 'boolean', default: false } }, ['projectKey']);
const source = { oneOf: [
  object({ type: { const: 'project' }, projectKeys: { type: 'array', minItems: 1, maxItems: 100, items: keyProperty } }, ['type', 'projectKeys']),
  object({ type: { const: 'milestone' }, milestoneKeys: { type: 'array', minItems: 1, maxItems: 100, items: keyProperty } }, ['type', 'milestoneKeys']),
  object({ type: { const: 'task' }, taskKeys: { type: 'array', minItems: 1, maxItems: 100, items: keyProperty } }, ['type', 'taskKeys']),
] };
jsonSchemas['scope.project.search'] = object({ scopeKey: keyProperty, query: { type: 'string', minLength: 1, maxLength: 4_000 }, sources: { type: 'array', maxItems: 100, items: source }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['scopeKey', 'query']);
jsonSchemas['organization.project.search'] = object({ query: { type: 'string', minLength: 1, maxLength: 4_000 }, scopeKeys: { type: 'array', maxItems: 100, items: keyProperty }, sources: { type: 'array', maxItems: 100, items: source }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['query']);

export const momentumToolJsonSchemas = jsonSchemas as { [K in keyof typeof momentumToolInputSchemas]: Record<string, unknown> };
export type MomentumActionSlug = keyof typeof momentumToolInputSchemas;
export const isMomentumAction = (action: string): action is MomentumActionSlug => action in momentumToolInputSchemas;
