import { z } from 'zod';
import { embedText } from '@/lib/bedrock-titan';
import type { Folder } from '@/lib/db/folders.node';
import type { Milestone } from '@/lib/db/milestones.node';
import type { Project } from '@/lib/db/projects.node';
import type { Task, TaskStatus } from '@/lib/db/tasks.node';
import { newId } from '@/lib/ids';
import { getDefaultMomentumRepository, type MomentumRepository } from './repository';
import { momentumToolInputSchemas, type MomentumActionSlug } from './tool-schemas';

const READ_ROLES = ['owner', 'admin', 'moderator', 'viewer'] as const;
const WRITE_ROLES = ['owner', 'admin', 'moderator'] as const;
const DELETE_ROLES = ['owner'] as const;

export type MomentumRole = (typeof READ_ROLES)[number];
export interface MomentumAuditData {
  scopeKey?: string;
  projectKey?: string;
  milestoneKey?: string;
  taskKey?: string;
  archiveFolderKey?: string;
  success?: boolean;
}

export interface MomentumReasonInput {
  action: 'summarize' | 'translate' | 'rewrite';
  task: Pick<Task, 'key' | 'title' | 'description'>;
  language?: string;
  instruction?: string;
}

export interface MomentumAuthorizationDependency {
  authorize(scopeKey: string, allowedRoles: readonly MomentumRole[]): void | Promise<void>;
}

export interface MomentumAuditDependency {
  audit(action: MomentumActionSlug, data: MomentumAuditData): void | Promise<void>;
}

export interface MomentumEmbeddingDependency {
  generateEmbedding?: (text: string) => Promise<readonly number[]>;
}

export interface MomentumReasonDependency {
  reason?: (input: MomentumReasonInput) => Promise<string>;
}

export interface MomentumExecutionDependencies extends MomentumAuthorizationDependency, MomentumAuditDependency, MomentumEmbeddingDependency, MomentumReasonDependency {
  repository?: MomentumRepository;
  createKey?: () => string;
  now?: () => string;
  organizationScopeKeys?: () => Promise<string[]>;
}

export interface MomentumItemSuccess<T = unknown> {
  index: number;
  success: true;
  value: T;
}

export interface MomentumItemFailure {
  index: number;
  success: false;
  error: { code: string; message: string };
}

export type MomentumItemResult<T = unknown> = MomentumItemSuccess<T> | MomentumItemFailure;

export interface MomentumToolResult {
  action: MomentumActionSlug;
  results?: MomentumItemResult[];
  items?: unknown[];
}

export class MomentumExecutionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'MomentumExecutionError';
  }
}

type Prepared<T> = {
  keys: MomentumAuditData;
  scopeKeys?: string[];
  run(repository: MomentumRepository): Promise<T>;
};

type BatchInput = { items: unknown[]; atomic: boolean };

function failure(index: number, error: unknown): MomentumItemFailure {
  return {
    index,
    success: false,
    error: {
      code: error instanceof MomentumExecutionError ? error.code : error instanceof z.ZodError ? 'invalid_input' : 'operation_failed',
      message: error instanceof Error ? error.message : 'Momentum operation failed.',
    },
  };
}

function requireNode<T>(node: T | null, kind: string, key: string): T {
  if (!node) throw new MomentumExecutionError(`${kind}_not_found`, `${kind} ${key} was not found.`);
  return node;
}

function requireActive(node: { deletedAt: string | null }, kind: string): void {
  if (node.deletedAt !== null) throw new MomentumExecutionError(`${kind}_archived`, `${kind} is archived.`);
}

function requireArchived(node: { deletedAt: string | null }, kind: string): void {
  if (node.deletedAt === null) throw new MomentumExecutionError(`${kind}_not_archived`, `${kind} must be archived before permanent deletion.`);
}

function semanticText(node: Pick<Project, 'name' | 'description'> | Pick<Milestone, 'name' | 'description'> | Pick<Task, 'title' | 'description'> | Pick<Folder, 'name' | 'description'>): string {
  const title = 'title' in node ? node.title : node.name;
  return [title, node.description].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('\n\n');
}

function validEmbedding(value: readonly number[]): number[] {
  const embedding = [...value];
  if (embedding.length === 0 || embedding.some((entry) => !Number.isFinite(entry))) {
    throw new MomentumExecutionError('invalid_embedding', 'Embedding must contain non-empty finite numbers.');
  }
  return embedding;
}

function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length || right.some((entry) => !Number.isFinite(entry))) return Number.NaN;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! ** 2;
    rightNorm += right[index]! ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : -1;
}

function publicNode<T extends { embedding: number[] }>(node: T): Omit<T, 'embedding'> {
  const { embedding: _embedding, ...view } = node;
  return view;
}

function safeKeys(item: Record<string, unknown>): MomentumAuditData {
  const output: MomentumAuditData = {};
  for (const key of ['scopeKey', 'projectKey', 'milestoneKey', 'taskKey', 'archiveFolderKey'] as const) {
    if (typeof item[key] === 'string') output[key] = item[key];
  }
  return output;
}

async function assertTransactionState(action: MomentumActionSlug, prepared: Prepared<unknown>, repository: MomentumRepository): Promise<void> {
  const { projectKey, milestoneKey, taskKey } = prepared.keys;
  if (action === 'project.create') return;
  if (action === 'milestone.create') {
    const project = requireNode(await repository.getProject(projectKey!), 'project', projectKey!);
    if (project.scopeKey !== prepared.keys.scopeKey) throw new MomentumExecutionError('invalid_ownership', 'Project scope changed during mutation preparation.');
    requireActive(project, 'project');
    return;
  }
  if (action === 'task.create') {
    const milestone = requireNode(await repository.getMilestone(milestoneKey!), 'milestone', milestoneKey!);
    const project = requireNode(await repository.getProject(projectKey!), 'project', projectKey!);
    if (milestone.projectKey !== project.key || milestone.scopeKey !== project.scopeKey || project.scopeKey !== prepared.keys.scopeKey) throw new MomentumExecutionError('invalid_ownership', 'Milestone ownership changed during mutation preparation.');
    requireActive(project, 'project'); requireActive(milestone, 'milestone');
    return;
  }
  if (action.startsWith('project.')) {
    const project = requireNode(await repository.getProject(projectKey!), 'project', projectKey!);
    action === 'project.restore' || action === 'project.delete' ? requireArchived(project, 'project') : requireActive(project, 'project');
    return;
  }
  if (action.startsWith('milestone.')) {
    const milestone = requireNode(await repository.getMilestone(milestoneKey!), 'milestone', milestoneKey!);
    action === 'milestone.restore' || action === 'milestone.delete' ? requireArchived(milestone, 'milestone') : requireActive(milestone, 'milestone');
    if (action !== 'milestone.archive' && action !== 'milestone.delete') {
      const project = requireNode(await repository.getProject(milestone.projectKey), 'project', milestone.projectKey);
      if (milestone.scopeKey !== project.scopeKey) throw new MomentumExecutionError('invalid_ownership', 'Milestone ownership changed during mutation preparation.');
      requireActive(project, 'project');
    }
    if (action === 'milestone.move') requireActive(requireNode(await repository.getProject(projectKey!), 'project', projectKey!), 'project');
    return;
  }
  if (action.startsWith('task.')) {
    const task = requireNode(await repository.getTask(taskKey!), 'task', taskKey!);
    action === 'task.restore' || action === 'task.delete' ? requireArchived(task, 'task') : requireActive(task, 'task');
    if (action !== 'task.archive' && action !== 'task.delete') {
      const project = requireNode(await repository.getProject(task.projectKey), 'project', task.projectKey);
      const milestone = requireNode(await repository.getMilestone(task.milestoneKey), 'milestone', task.milestoneKey);
      if (task.scopeKey !== project.scopeKey || milestone.projectKey !== project.key || milestone.scopeKey !== project.scopeKey) throw new MomentumExecutionError('invalid_ownership', 'Task ownership changed during mutation preparation.');
      requireActive(project, 'project'); requireActive(milestone, 'milestone');
    }
    if (action === 'task.move') {
      const destinationProject = requireNode(await repository.getProject(projectKey!), 'project', projectKey!);
      const destinationMilestone = requireNode(await repository.getMilestone(milestoneKey!), 'milestone', milestoneKey!);
      if (destinationMilestone.projectKey !== destinationProject.key || destinationMilestone.scopeKey !== destinationProject.scopeKey) throw new MomentumExecutionError('invalid_ownership', 'Destination ownership changed during mutation preparation.');
      requireActive(destinationProject, 'project'); requireActive(destinationMilestone, 'milestone');
    }
  }
}

async function safeAudit(audit: MomentumExecutionDependencies['audit'], action: MomentumActionSlug, data: MomentumAuditData): Promise<void> {
  try { await audit(action, data); }
  catch (error) { console.warn('Momentum audit event failed', { action, error: error instanceof Error ? error.message : String(error) }); }
}

async function executeBatch<T>(
  action: MomentumActionSlug,
  input: BatchInput,
  repository: MomentumRepository,
  audit: MomentumExecutionDependencies['audit'],
  prepare: (item: any, index: number) => Promise<Prepared<T>>,
): Promise<MomentumToolResult> {
  if (input.atomic) {
    const targetField = action.startsWith('project.') && action !== 'project.create' ? 'projectKey'
      : action.startsWith('milestone.') && action !== 'milestone.create' ? 'milestoneKey'
        : action.startsWith('task.') && action !== 'task.create' ? 'taskKey'
          : null;
    const targets = targetField ? input.items.map((item) => (item as Record<string, unknown>)[targetField] as string) : [];
    if (new Set(targets).size !== targets.length) {
      const error = new MomentumExecutionError('atomic_duplicate_target', 'An atomic batch may target each existing resource only once.');
      const results = input.items.map((_, index) => failure(index, error));
      for (let index = 0; index < results.length; index += 1) await safeAudit(audit, action, { ...safeKeys(input.items[index] as Record<string, unknown>), success: false });
      return { action, results };
    }
    const prepared: Prepared<T>[] = [];
    const preparationFailures: MomentumItemFailure[] = [];
    for (let index = 0; index < input.items.length; index += 1) {
      try {
        prepared.push(await prepare(input.items[index], index));
      } catch (error) {
        preparationFailures.push(failure(index, error));
      }
    }
    if (preparationFailures.length) {
      const first = preparationFailures[0]!.error;
      const failed = input.items.map((_, index) => preparationFailures.find((item) => item.index === index) ?? failure(index, new MomentumExecutionError('atomic_prevalidation_failed', `Atomic batch was not written because another item failed prevalidation: ${first.message}`)));
      for (let index = 0; index < failed.length; index += 1) await safeAudit(audit, action, { ...safeKeys(input.items[index] as Record<string, unknown>), success: false });
      return { action, results: failed };
    }
    try {
      const values = await repository.withAtomic(async (transaction) => {
        const scopeKeys = prepared.flatMap((item) => item.scopeKeys ?? (item.keys.scopeKey ? [item.keys.scopeKey] : []));
        if (!await transaction.areScopesActive(scopeKeys)) throw new MomentumExecutionError('scope_archived', 'A scope was archived before the transaction committed.');
        const output: T[] = [];
        for (const item of prepared) { await assertTransactionState(action, item, transaction); output.push(await item.run(transaction)); }
        return output;
      });
      const results = values.map((value, index): MomentumItemSuccess<T> => ({ index, success: true, value }));
      for (let index = 0; index < results.length; index += 1) await safeAudit(audit, action, { ...prepared[index]!.keys, success: true });
      return { action, results };
    } catch (error) {
      const results = input.items.map((_, index) => failure(index, error));
      for (let index = 0; index < results.length; index += 1) await safeAudit(audit, action, { ...prepared[index]!.keys, success: false });
      return { action, results };
    }
  }

  const results: MomentumItemResult<T>[] = [];
  for (let index = 0; index < input.items.length; index += 1) {
    let keys = safeKeys(input.items[index] as Record<string, unknown>);
    let outcome: MomentumItemResult<T>;
    try {
      const prepared = await prepare(input.items[index], index);
      keys = prepared.keys;
      const value = await repository.withAtomic(async (transaction) => {
        const scopeKeys = prepared.scopeKeys ?? (prepared.keys.scopeKey ? [prepared.keys.scopeKey] : []);
        if (!await transaction.areScopesActive(scopeKeys)) throw new MomentumExecutionError('scope_archived', 'The scope was archived before the transaction committed.');
        await assertTransactionState(action, prepared, transaction);
        return prepared.run(transaction);
      });
      outcome = { index, success: true, value };
    } catch (error) {
      outcome = failure(index, error);
    }
    results.push(outcome);
    await safeAudit(audit, action, { ...keys, success: outcome.success });
  }
  return { action, results };
}

/** Executes one validated Momentum action using only repository-level persistence APIs. */
export async function executeMomentumTool(
  action: MomentumActionSlug,
  rawInput: unknown,
  dependencies: MomentumExecutionDependencies,
): Promise<MomentumToolResult> {
  const input = momentumToolInputSchemas[action].parse(rawInput) as any;
  const repository = dependencies.repository ?? getDefaultMomentumRepository();
  const authorize = dependencies.authorize;
  const audit = dependencies.audit;
  const key = dependencies.createKey ?? newId;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const generateEmbedding = dependencies.generateEmbedding ?? (async (text: string) => embedText({ text }));
  const embeddingCache = new Map<string, Promise<number[]>>();
  const embeddingFor = (node: Parameters<typeof semanticText>[0]) => {
    const text = semanticText(node);
    let pending = embeddingCache.get(text);
    if (!pending) { pending = generateEmbedding(text).then(validEmbedding); embeddingCache.set(text, pending); }
    return pending;
  };

  const projectContext = async (projectKey: string, roles: readonly MomentumRole[] = WRITE_ROLES, active = true) => {
    const project = requireNode(await repository.getProject(projectKey), 'project', projectKey);
    await authorize(project.scopeKey, roles);
    if (active) requireActive(project, 'project');
    return project;
  };
  const milestoneContext = async (milestoneKey: string, roles: readonly MomentumRole[] = WRITE_ROLES, active = true) => {
    const milestone = requireNode(await repository.getMilestone(milestoneKey), 'milestone', milestoneKey);
    const project = requireNode(await repository.getProject(milestone.projectKey), 'project', milestone.projectKey);
    if (milestone.scopeKey !== project.scopeKey) throw new MomentumExecutionError('invalid_ownership', 'Milestone ownership is inconsistent.');
    await authorize(project.scopeKey, roles);
    if (active) { requireActive(project, 'project'); requireActive(milestone, 'milestone'); }
    return { milestone, project };
  };
  const taskContext = async (taskKey: string, roles: readonly MomentumRole[] = WRITE_ROLES, active = true) => {
    const task = requireNode(await repository.getTask(taskKey), 'task', taskKey);
    const milestone = requireNode(await repository.getMilestone(task.milestoneKey), 'milestone', task.milestoneKey);
    const project = requireNode(await repository.getProject(task.projectKey), 'project', task.projectKey);
    if (task.projectKey !== milestone.projectKey || task.scopeKey !== milestone.scopeKey || project.scopeKey !== task.scopeKey) {
      throw new MomentumExecutionError('invalid_ownership', 'Task ownership is inconsistent.');
    }
    await authorize(project.scopeKey, roles);
    if (active) { requireActive(project, 'project'); requireActive(milestone, 'milestone'); requireActive(task, 'task'); }
    return { task, milestone, project };
  };
  const projectChildren = async (projectKey: string, source: MomentumRepository = repository) => ({
    milestones: await source.listMilestones(projectKey, { includeDeleted: true }),
    tasks: await source.listTasks(projectKey, { includeDeleted: true }),
  });
  const updateProject = async (source: MomentumRepository, project: Project, patch: Partial<Project>) => {
    const next = { ...project, ...patch };
    const semantic = Object.prototype.hasOwnProperty.call(patch, 'name') || Object.prototype.hasOwnProperty.call(patch, 'description');
    return source.updateProject(project.key, { ...patch, embedding: semantic ? await embeddingFor(next) : project.embedding, updatedAt: now() }, project.updatedAt);
  };
  const updateMilestone = async (source: MomentumRepository, milestone: Milestone, patch: Partial<Milestone>) => {
    const next = { ...milestone, ...patch };
    const semantic = Object.prototype.hasOwnProperty.call(patch, 'name') || Object.prototype.hasOwnProperty.call(patch, 'description');
    return source.updateMilestone(milestone.key, { ...patch, embedding: semantic ? await embeddingFor(next) : milestone.embedding, updatedAt: now() }, milestone.updatedAt);
  };
  const updateTask = async (source: MomentumRepository, task: Task, patch: Partial<Task>) => {
    const next = { ...task, ...patch };
    const semantic = Object.prototype.hasOwnProperty.call(patch, 'title') || Object.prototype.hasOwnProperty.call(patch, 'description');
    return source.updateTask(task.key, { ...patch, embedding: semantic ? await embeddingFor(next) : task.embedding, updatedAt: now() }, task.updatedAt);
  };
  const updateFolder = async (source: MomentumRepository, project: Project, patch: Partial<Folder>) => source.updateArchiveFolder(project.archiveFolderKey, {
    ...patch,
    embedding: Object.prototype.hasOwnProperty.call(patch, 'name') || Object.prototype.hasOwnProperty.call(patch, 'description')
      ? await embeddingFor({
          name: Object.prototype.hasOwnProperty.call(patch, 'name') ? patch.name ?? project.name : project.name,
          description: Object.prototype.hasOwnProperty.call(patch, 'description') ? patch.description : project.description,
        })
      : project.embedding,
    updatedAt: now(),
  });
  const undefinedWhenNull = (value: unknown) => value === null ? undefined : value;

  if (action === 'project.create') return executeBatch(action, input, repository, audit, async (item) => {
    await authorize(item.scopeKey, WRITE_ROLES);
    const projectKey = key();
    const archiveFolderKey = key();
    const timestamp = now();
    const project: Project = { key: projectKey, scopeKey: item.scopeKey, archiveFolderKey, name: item.name, ...(item.description ? { description: item.description } : {}), embedding: await embeddingFor(item), deletedAt: null, createdAt: timestamp, updatedAt: timestamp };
    const folder: Folder = { key: archiveFolderKey, scopeKey: item.scopeKey, name: item.name, ...(item.description ? { description: item.description } : {}), embedding: await embeddingFor(item), deletedAt: null, createdAt: timestamp, updatedAt: timestamp };
    return { keys: { scopeKey: item.scopeKey, projectKey, archiveFolderKey }, run: async (source) => { const created = await source.createProject(project); await source.createArchiveFolder(folder); return created; } };
  });

  if (action === 'project.find') {
    const items = [];
    for (const projectKey of input.projectKeys) { const project = await projectContext(projectKey, READ_ROLES, false); items.push(publicNode(project)); await safeAudit(audit, action, { scopeKey: project.scopeKey, projectKey, success: true }); }
    return { action, items };
  }
  if (action === 'project.list') {
    await authorize(input.scopeKey, READ_ROLES);
    const items = (await repository.listProjects(input.scopeKey, { includeDeleted: input.includeArchived })).map(publicNode);
    await safeAudit(audit, action, { scopeKey: input.scopeKey, success: true });
    return { action, items };
  }
  if (action === 'project.update' || action === 'project.rename') return executeBatch(action, input, repository, audit, async (item) => {
    const project = await projectContext(item.projectKey);
    const patch: Partial<Project> = action === 'project.rename' ? { name: item.name } : {};
    if (action === 'project.update' && item.name !== undefined) patch.name = item.name;
    if (action === 'project.update' && Object.prototype.hasOwnProperty.call(item, 'description')) patch.description = undefinedWhenNull(item.description) as string | undefined;
    await embeddingFor({ ...project, ...patch });
    return { keys: { scopeKey: project.scopeKey, projectKey: project.key, archiveFolderKey: project.archiveFolderKey }, run: async (source) => { const updated = await updateProject(source, project, patch); await updateFolder(source, project, patch); return updated; } };
  });
  if (action === 'project.move') return executeBatch(action, input, repository, audit, async (item) => {
    const project = await projectContext(item.projectKey);
    await authorize(item.scopeKey, WRITE_ROLES);
    return { keys: { scopeKey: item.scopeKey, projectKey: project.key, archiveFolderKey: project.archiveFolderKey }, scopeKeys: [project.scopeKey, item.scopeKey], run: async (source) => {
      const children = await projectChildren(project.key, source);
      const updated = await updateProject(source, project, { scopeKey: item.scopeKey });
      await updateFolder(source, project, { scopeKey: item.scopeKey });
      for (const milestone of children.milestones) await updateMilestone(source, milestone, { scopeKey: item.scopeKey });
      for (const task of children.tasks) await updateTask(source, task, { scopeKey: item.scopeKey });
      return updated;
    } };
  });
  if (action === 'project.archive' || action === 'project.restore') return executeBatch(action, input, repository, audit, async (item) => {
    const restoring = action === 'project.restore';
    const project = await projectContext(item.projectKey, WRITE_ROLES, false);
    restoring ? requireArchived(project, 'project') : requireActive(project, 'project');
    const deletedAt = restoring ? null : now();
    return { keys: { scopeKey: project.scopeKey, projectKey: project.key, archiveFolderKey: project.archiveFolderKey }, run: async (source) => {
      const updated = await updateProject(source, project, { deletedAt });
      await updateFolder(source, project, { deletedAt });
      return updated;
    } };
  });
  if (action === 'project.delete') return executeBatch(action, input, repository, audit, async (item) => {
    const project = await projectContext(item.projectKey, DELETE_ROLES, false);
    requireArchived(project, 'project');
    return { keys: { scopeKey: project.scopeKey, projectKey: project.key, archiveFolderKey: project.archiveFolderKey }, run: async (source) => {
      const children = await projectChildren(project.key, source);
      for (const milestone of children.milestones) requireArchived(milestone, 'milestone');
      for (const task of children.tasks) requireArchived(task, 'task');
      for (const task of children.tasks) await source.deleteTask(task.key);
      for (const milestone of children.milestones) await source.deleteMilestone(milestone.key);
      await source.deleteProject(project.key);
      await source.deleteArchiveFolder(project.archiveFolderKey);
      return { projectKey: project.key };
    } };
  });

  if (action === 'milestone.create') return executeBatch(action, input, repository, audit, async (item) => {
    const project = await projectContext(item.projectKey);
    const timestamp = now();
    const milestone: Milestone = { key: key(), scopeKey: project.scopeKey, projectKey: project.key, name: item.name, ...(item.description ? { description: item.description } : {}), status: item.status, ...(item.startDate ? { startDate: item.startDate } : {}), ...(item.endDate ? { endDate: item.endDate } : {}), order: item.order, embedding: await embeddingFor(item), deletedAt: null, createdAt: timestamp, updatedAt: timestamp };
    return { keys: { scopeKey: project.scopeKey, projectKey: project.key, milestoneKey: milestone.key }, run: (source) => source.createMilestone(milestone) };
  });
  if (action === 'milestone.find') {
    const items = [];
    for (const milestoneKey of input.milestoneKeys) { const context = await milestoneContext(milestoneKey, READ_ROLES, false); items.push(publicNode(context.milestone)); await safeAudit(audit, action, { scopeKey: context.project.scopeKey, projectKey: context.project.key, milestoneKey, success: true }); }
    return { action, items };
  }
  if (action === 'milestone.list') {
    const project = await projectContext(input.projectKey, READ_ROLES, false);
    const items = (await repository.listMilestones(project.key, { includeDeleted: input.includeArchived })).map(publicNode);
    await safeAudit(audit, action, { scopeKey: project.scopeKey, projectKey: project.key, success: true });
    return { action, items };
  }
  if (action === 'milestone.update' || action === 'milestone.rename' || action === 'milestone.schedule' || action === 'milestone.change-status' || action === 'milestone.complete' || action === 'milestone.reopen') return executeBatch(action, input, repository, audit, async (item) => {
    const { milestone, project } = await milestoneContext(item.milestoneKey);
    let patch: Partial<Milestone>;
    if (action === 'milestone.rename') patch = { name: item.name };
    else if (action === 'milestone.schedule') patch = Object.fromEntries(Object.entries({ startDate: undefinedWhenNull(item.startDate), endDate: undefinedWhenNull(item.endDate) }).filter(([field, value]) => value !== undefined || item[field] === null));
    else if (action === 'milestone.change-status') patch = { status: item.status, ...(item.status === 'completed' ? { completedAt: now() } : { completedAt: undefined }) };
    else if (action === 'milestone.complete') patch = { status: 'completed', completedAt: now() };
    else if (action === 'milestone.reopen') patch = { status: 'active', completedAt: undefined };
    else {
      patch = Object.fromEntries(Object.entries(item).filter(([field, value]) => field !== 'milestoneKey' && value !== undefined).map(([field, value]) => [field, undefinedWhenNull(value)]));
      if (item.status) patch.completedAt = item.status === 'completed' ? now() : undefined;
    }
    await embeddingFor({ ...milestone, ...patch });
    return { keys: { scopeKey: project.scopeKey, projectKey: project.key, milestoneKey: milestone.key }, run: (source) => updateMilestone(source, milestone, patch) };
  });
  if (action === 'milestone.move') return executeBatch(action, input, repository, audit, async (item) => {
    const { milestone, project: oldProject } = await milestoneContext(item.milestoneKey);
    const project = await projectContext(item.projectKey);
    return { keys: { scopeKey: project.scopeKey, projectKey: project.key, milestoneKey: milestone.key }, scopeKeys: [oldProject.scopeKey, project.scopeKey], run: async (source) => {
      const tasks = await source.listTasks(oldProject.key, { milestoneKey: milestone.key, includeDeleted: true });
      const updated = await updateMilestone(source, milestone, { projectKey: project.key, scopeKey: project.scopeKey, ...(item.order === undefined ? {} : { order: item.order }) });
      for (const task of tasks) await updateTask(source, task, { projectKey: project.key, scopeKey: project.scopeKey });
      return updated;
    } };
  });
  if (action === 'milestone.archive' || action === 'milestone.restore') return executeBatch(action, input, repository, audit, async (item) => {
    const restoring = action === 'milestone.restore';
    const { milestone, project } = await milestoneContext(item.milestoneKey, WRITE_ROLES, false);
    if (restoring) { requireActive(project, 'project'); requireArchived(milestone, 'milestone'); } else requireActive(milestone, 'milestone');
    const deletedAt = restoring ? null : now();
    return { keys: { scopeKey: project.scopeKey, projectKey: project.key, milestoneKey: milestone.key }, run: async (source) => {
      const updated = await updateMilestone(source, milestone, { deletedAt });
      return updated;
    } };
  });
  if (action === 'milestone.delete') return executeBatch(action, input, repository, audit, async (item) => {
    const { milestone, project } = await milestoneContext(item.milestoneKey, DELETE_ROLES, false);
    requireArchived(milestone, 'milestone');
    return { keys: { scopeKey: project.scopeKey, projectKey: project.key, milestoneKey: milestone.key }, run: async (source) => { const tasks = await source.listTasks(project.key, { milestoneKey: milestone.key, includeDeleted: true }); for (const task of tasks) requireArchived(task, 'task'); for (const task of tasks) await source.deleteTask(task.key); await source.deleteMilestone(milestone.key); return { milestoneKey: milestone.key }; } };
  });

  if (action === 'task.create') return executeBatch(action, input, repository, audit, async (item) => {
    const { milestone, project } = await milestoneContext(item.milestoneKey);
    const timestamp = now();
    const task: Task = { key: key(), scopeKey: project.scopeKey, projectKey: project.key, milestoneKey: milestone.key, title: item.title, ...(item.description ? { description: item.description } : {}), status: item.status, priority: item.priority, position: item.position, embedding: await embeddingFor(item), deletedAt: null, createdAt: timestamp, updatedAt: timestamp };
    return { keys: { scopeKey: project.scopeKey, projectKey: project.key, milestoneKey: milestone.key, taskKey: task.key }, run: (source) => source.createTask(task) };
  });
  if (action === 'task.find') {
    const items = [];
    for (const taskKey of input.taskKeys) { const context = await taskContext(taskKey, READ_ROLES, false); items.push(publicNode(context.task)); await safeAudit(audit, action, { scopeKey: context.project.scopeKey, projectKey: context.project.key, milestoneKey: context.milestone.key, taskKey, success: true }); }
    return { action, items };
  }
  if (action === 'task.list') {
    const project = await projectContext(input.projectKey, READ_ROLES, false);
    if (input.milestoneKey) { const context = await milestoneContext(input.milestoneKey, READ_ROLES, false); if (context.project.key !== project.key) throw new MomentumExecutionError('invalid_ownership', 'Milestone belongs to another project.'); }
    const items = (await repository.listTasks(project.key, { milestoneKey: input.milestoneKey, includeDeleted: input.includeArchived })).map(publicNode);
    await safeAudit(audit, action, { scopeKey: project.scopeKey, projectKey: project.key, ...(input.milestoneKey ? { milestoneKey: input.milestoneKey } : {}), success: true });
    return { action, items };
  }
  if (action === 'task.update' || action === 'task.rename' || action === 'task.reorder' || action === 'task.change-status' || action === 'task.complete' || action === 'task.reopen') return executeBatch(action, input, repository, audit, async (item) => {
    const { task, milestone, project } = await taskContext(item.taskKey);
    let patch: Partial<Task>;
    if (action === 'task.rename') patch = { title: item.title };
    else if (action === 'task.reorder') patch = { position: item.position };
    else if (action === 'task.change-status') patch = { status: item.status as TaskStatus };
    else if (action === 'task.complete') patch = { status: 'completed' };
    else if (action === 'task.reopen') patch = { status: 'todo' };
    else patch = Object.fromEntries(Object.entries(item).filter(([field, value]) => field !== 'taskKey' && value !== undefined).map(([field, value]) => [field, undefinedWhenNull(value)]));
    await embeddingFor({ ...task, ...patch });
    return { keys: { scopeKey: project.scopeKey, projectKey: project.key, milestoneKey: milestone.key, taskKey: task.key }, run: (source) => updateTask(source, task, patch) };
  });
  if (action === 'task.move') return executeBatch(action, input, repository, audit, async (item) => {
    const { task } = await taskContext(item.taskKey);
    const { milestone, project } = await milestoneContext(item.milestoneKey);
    return { keys: { scopeKey: project.scopeKey, projectKey: project.key, milestoneKey: milestone.key, taskKey: task.key }, scopeKeys: [task.scopeKey, project.scopeKey], run: (source) => updateTask(source, task, { milestoneKey: milestone.key, projectKey: project.key, scopeKey: project.scopeKey, ...(item.position === undefined ? {} : { position: item.position }) }) };
  });
  if (action === 'task.archive' || action === 'task.restore') return executeBatch(action, input, repository, audit, async (item) => {
    const restoring = action === 'task.restore';
    const { task, milestone, project } = await taskContext(item.taskKey, WRITE_ROLES, false);
    if (restoring) { requireActive(project, 'project'); requireActive(milestone, 'milestone'); requireArchived(task, 'task'); } else requireActive(task, 'task');
    return { keys: { scopeKey: project.scopeKey, projectKey: project.key, milestoneKey: milestone.key, taskKey: task.key }, run: (source) => updateTask(source, task, { deletedAt: restoring ? null : now() }) };
  });
  if (action === 'task.delete') return executeBatch(action, input, repository, audit, async (item) => {
    const { task, milestone, project } = await taskContext(item.taskKey, DELETE_ROLES, false);
    requireArchived(task, 'task');
    return { keys: { scopeKey: project.scopeKey, projectKey: project.key, milestoneKey: milestone.key, taskKey: task.key }, run: async (source) => { await source.deleteTask(task.key); return { taskKey: task.key }; } };
  });

  if (action === 'task.summarize' || action === 'task.translate' || action === 'task.rewrite') return executeBatch(action, input, repository, audit, async (item) => {
    const { task, milestone, project } = await taskContext(item.taskKey, item.persist ? WRITE_ROLES : READ_ROLES);
    if (!dependencies.reason) throw new MomentumExecutionError('reason_unavailable', 'A reason(input) dependency is required because Momentum input does not contain an organization key for route selection.');
    const operation = action.slice('task.'.length) as MomentumReasonInput['action'];
    const text = (await dependencies.reason({ action: operation, task: { key: task.key, title: task.title, description: task.description }, ...(item.language ? { language: item.language } : {}), ...(item.instruction ? { instruction: item.instruction } : {}) })).trim();
    if (!text) throw new MomentumExecutionError('empty_reason_result', 'Reasoning returned empty text.');
    const preparedEmbedding = item.persist ? await embeddingFor({ ...task, description: text }) : null;
    return { keys: { scopeKey: project.scopeKey, projectKey: project.key, milestoneKey: milestone.key, taskKey: task.key }, run: async (source) => {
      if (item.persist) await source.updateTask(task.key, { description: text, embedding: preparedEmbedding!, updatedAt: now() }, task.updatedAt);
      return { taskKey: task.key, text, persisted: item.persist };
    } };
  });

  if (action === 'scope.project.search' || action === 'organization.project.search') {
    const queryEmbedding = validEmbedding(await generateEmbedding(input.query));
    const projects = action === 'scope.project.search'
      ? (await authorize(input.scopeKey, READ_ROLES), await repository.listProjects(input.scopeKey))
      : dependencies.organizationScopeKeys
        ? await repository.listProjectsByScopes(await dependencies.organizationScopeKeys())
        : await repository.listAllProjects();
    const requestedScopes = action === 'organization.project.search' && input.scopeKeys.length ? new Set<string>(input.scopeKeys) : null;
    const authorizedScopes = new Map<string, boolean>();
    if (action === 'scope.project.search') authorizedScopes.set(input.scopeKey, true);
    const canRead = async (scopeKey: string) => {
      if (requestedScopes && !requestedScopes.has(scopeKey)) return false;
      if (authorizedScopes.has(scopeKey)) return authorizedScopes.get(scopeKey)!;
      try { await authorize(scopeKey, READ_ROLES); authorizedScopes.set(scopeKey, true); } catch { authorizedScopes.set(scopeKey, false); }
      return authorizedScopes.get(scopeKey)!;
    };
    const selected = new Map<string, Set<string>>();
    for (const source of input.sources as Array<Record<string, unknown>>) {
      const type = source.type as string;
      const keys = source[`${type}Keys`] as string[];
      selected.set(type, new Set([...(selected.get(type) ?? []), ...keys]));
    }
    const accepts = (type: string, nodeKey: string) => selected.size === 0 || selected.get(type)?.has(nodeKey) === true;
    const ranked: Array<{ type: 'project' | 'milestone' | 'task'; score: number; item: Project | Milestone | Task }> = [];
    for (const project of projects) {
      if (!await canRead(project.scopeKey) || project.deletedAt !== null) continue;
      if (accepts('project', project.key)) ranked.push({ type: 'project', score: cosine(queryEmbedding, project.embedding), item: project });
      const milestones = await repository.listMilestones(project.key);
      const milestoneKeys = new Set(milestones.map((milestone) => milestone.key));
      for (const milestone of milestones) if (accepts('milestone', milestone.key)) ranked.push({ type: 'milestone', score: cosine(queryEmbedding, milestone.embedding), item: milestone });
      for (const task of await repository.listTasks(project.key)) if (milestoneKeys.has(task.milestoneKey) && accepts('task', task.key)) ranked.push({ type: 'task', score: cosine(queryEmbedding, task.embedding), item: task });
    }
    const items = ranked.filter((result) => Number.isFinite(result.score)).sort((left, right) => right.score - left.score || left.item.key.localeCompare(right.item.key)).slice(0, input.limit).map((result) => ({ ...result, item: publicNode(result.item) }));
    await safeAudit(audit, action, { ...(action === 'scope.project.search' ? { scopeKey: input.scopeKey } : {}), success: true });
    return { action, items };
  }

  const exhaustive: never = action;
  throw new MomentumExecutionError('unsupported_action', `Unsupported Momentum action: ${exhaustive}`);
}
