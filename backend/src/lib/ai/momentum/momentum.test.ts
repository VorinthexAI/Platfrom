import { describe, expect, test } from 'bun:test';
import type { Folder } from '@/lib/db/folders.node';
import type { Milestone } from '@/lib/db/milestones.node';
import type { Project } from '@/lib/db/projects.node';
import type { Task } from '@/lib/db/tasks.node';
import { executeDomainTool, domainToolInputSchemas, domainToolJsonSchemas } from '@/lib/ai/tools';
import { momentumToolInputSchemas, type MomentumActionSlug } from './tool-schemas';
import { momentumToolJsonSchemas } from './tool-schemas';
import { executeMomentumTool } from './execute';
import type { MilestoneUpdate, MomentumRepository, ProjectUpdate, TaskUpdate } from './repository';

const scopeKey = 'cmrnlzf640000qc7k4p5zem5w';
const otherScopeKey = 'cmrnlzf640001qc7k4p5zem5w';
const timestamp = '2026-07-22T00:00:00.000Z';

function memoryRepository() {
  let projects = new Map<string, Project>();
  let milestones = new Map<string, Milestone>();
  let tasks = new Map<string, Task>();
  let folders = new Map<string, Folder>();
  let transactionScopesActive = true;
  let beforeAtomic: (() => void) | null = null;
  const update = <T extends { key: string; updatedAt?: string }>(map: Map<string, T>, key: string, patch: Partial<T>, expectedUpdatedAt?: string) => {
    const current = map.get(key);
    if (!current) throw new Error(`missing ${key}`);
    if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) throw new Error(`concurrent update ${key}`);
    const next = { ...current, ...patch } as T;
    for (const [field, value] of Object.entries(next)) if (value === undefined) delete (next as Record<string, unknown>)[field];
    map.set(key, next);
    return next;
  };
  const repository: MomentumRepository = {
    async createProject(value) { if (projects.has(value.key)) throw new Error('duplicate project'); projects.set(value.key, structuredClone(value)); return value; },
    async getProject(key) { return structuredClone(projects.get(key) ?? null); },
    async updateProject(key, patch: ProjectUpdate, expectedUpdatedAt) { return structuredClone(update(projects, key, patch, expectedUpdatedAt)); },
    async deleteProject(key) { projects.delete(key); },
    async listProjects(owner, options) { return [...projects.values()].filter((item) => item.scopeKey === owner && (options?.includeDeleted || item.deletedAt === null)).map((item) => structuredClone(item)); },
    async listAllProjects(options) { return [...projects.values()].filter((item) => options?.includeDeleted || item.deletedAt === null).map((item) => structuredClone(item)); },
    async listProjectsByScopes(scopeKeys, options) { const allowed = new Set(scopeKeys); return [...projects.values()].filter((item) => allowed.has(item.scopeKey) && (options?.includeDeleted || item.deletedAt === null)).map((item) => structuredClone(item)); },
    async createMilestone(value) { milestones.set(value.key, structuredClone(value)); return value; },
    async getMilestone(key) { return structuredClone(milestones.get(key) ?? null); },
    async updateMilestone(key, patch: MilestoneUpdate, expectedUpdatedAt) { return structuredClone(update(milestones, key, patch, expectedUpdatedAt)); },
    async deleteMilestone(key) { milestones.delete(key); },
    async listMilestones(owner, options) { return [...milestones.values()].filter((item) => item.projectKey === owner && (options?.includeDeleted || item.deletedAt === null)).map((item) => structuredClone(item)); },
    async createTask(value) { tasks.set(value.key, structuredClone(value)); return value; },
    async getTask(key) { return structuredClone(tasks.get(key) ?? null); },
    async updateTask(key, patch: TaskUpdate, expectedUpdatedAt) { return structuredClone(update(tasks, key, patch, expectedUpdatedAt)); },
    async deleteTask(key) { tasks.delete(key); },
    async listTasks(owner, options) { return [...tasks.values()].filter((item) => item.projectKey === owner && (!options?.milestoneKey || item.milestoneKey === options.milestoneKey) && (options?.includeDeleted || item.deletedAt === null)).map((item) => structuredClone(item)); },
    async createArchiveFolder(value) { if (folders.has(value.key)) throw new Error('duplicate folder'); folders.set(value.key, structuredClone(value)); return value; },
    async updateArchiveFolder(key, patch) { return structuredClone(update(folders, key, patch)); },
    async deleteArchiveFolder(key) { folders.delete(key); },
    async areScopesActive() { return transactionScopesActive; },
    async withAtomic(operation) {
      beforeAtomic?.(); beforeAtomic = null;
      const snapshots = [projects, milestones, tasks, folders].map((map) => structuredClone(map));
      try { return await operation(repository); }
      catch (error) { [projects, milestones, tasks, folders] = snapshots as [Map<string, Project>, Map<string, Milestone>, Map<string, Task>, Map<string, Folder>]; throw error; }
    },
  };
  return { repository, setTransactionScopesActive(value: boolean) { transactionScopesActive = value; }, setBeforeAtomic(value: () => void) { beforeAtomic = value; }, get projects() { return projects; }, get milestones() { return milestones; }, get tasks() { return tasks; }, get folders() { return folders; } };
}

function harness(deniedScope?: string) {
  const memory = memoryRepository();
  const audits: Array<{ action: string; data: unknown }> = [];
  let counter = 0;
  const execute = (action: MomentumActionSlug, input: unknown) => executeMomentumTool(action, input, {
    repository: memory.repository,
    createKey: () => `cmrnlzf64${String(counter++).padStart(4, '0')}qc7k4p5zem5w`,
    now: () => timestamp,
    generateEmbedding: async (text) => [text.length, 1],
    authorize: async (scope) => { if (scope === deniedScope) throw new Error('forbidden'); },
    audit: async (action, data) => { audits.push({ action, data }); },
    reason: async ({ action, language, instruction, task }) => `${action}:${language ?? instruction ?? task.title}`,
  });
  return {
    repository: memory.repository,
    setTransactionScopesActive: memory.setTransactionScopesActive,
    setBeforeAtomic: memory.setBeforeAtomic,
    audits,
    execute,
    get projects() { return memory.projects; },
    get milestones() { return memory.milestones; },
    get tasks() { return memory.tasks; },
    get folders() { return memory.folders; },
  };
}

async function createHierarchy(context: ReturnType<typeof harness>) {
  const projectResult = await context.execute('project.create', { items: [{ scopeKey, name: 'Apollo', description: 'Moon delivery' }], atomic: true });
  const project = (projectResult.results![0] as { success: true; value: Project }).value;
  const milestoneResult = await context.execute('milestone.create', { items: [{ projectKey: project.key, name: 'Launch', status: 'planned', order: 0 }], atomic: true });
  const milestone = (milestoneResult.results![0] as { success: true; value: Milestone }).value;
  const taskResult = await context.execute('task.create', { items: [{ milestoneKey: milestone.key, title: 'Fuel rocket', priority: 'critical', status: 'todo', position: 0 }], atomic: true });
  const task = (taskResult.results![0] as { success: true; value: Task }).value;
  return { project, milestone, task };
}

describe('Momentum schemas and registration', () => {
  test('registers every specified tool with strict runtime and JSON schemas', () => {
    expect(Object.keys(momentumToolInputSchemas)).toHaveLength(40);
    for (const [action, schema] of Object.entries(momentumToolInputSchemas)) {
      expect(action in domainToolInputSchemas).toBe(true);
      expect(action in domainToolJsonSchemas).toBe(true);
      expect(() => schema.parse({ unknown: true })).toThrow();
    }
  });

  test('enforces exact statuses, priorities, hierarchy, and batch bounds', () => {
    expect(() => momentumToolInputSchemas['milestone.create'].parse({ items: [{ projectKey: scopeKey, name: 'M', status: 'pending' }] })).toThrow();
    expect(() => momentumToolInputSchemas['task.create'].parse({ items: [{ milestoneKey: scopeKey, title: 'T', priority: 'urgent' }] })).toThrow();
    expect(() => momentumToolInputSchemas['project.create'].parse({ items: [] })).toThrow();
    expect(momentumToolInputSchemas['task.create'].parse({ items: [{ milestoneKey: scopeKey, title: 'T' }] }).atomic).toBe(true);
  });

  test('keeps model JSON requirements aligned with strict runtime schemas', () => {
    const projectCreate = momentumToolJsonSchemas['project.create'] as { properties: { items: { items: { required: string[] } } } };
    const taskTranslate = momentumToolJsonSchemas['task.translate'] as { properties: { items: { items: { required: string[] } } } };
    const scopeSearch = momentumToolJsonSchemas['scope.project.search'] as { required: string[]; properties: { sources: { items: { oneOf: unknown[] } } } };
    expect(projectCreate.properties.items.items.required).toEqual(['scopeKey', 'name']);
    expect(taskTranslate.properties.items.items.required).toEqual(['taskKey', 'language']);
    expect(scopeSearch.required).toEqual(['scopeKey', 'query']);
    expect(scopeSearch.properties.sources.items.oneOf).toHaveLength(3);
  });
});

describe('Project tools', () => {
  test('creates a project and canonical Archive folder atomically', async () => {
    const context = harness();
    const result = await context.execute('project.create', { items: [{ scopeKey, name: 'Apollo' }], atomic: true });
    const project = (result.results![0] as { success: true; value: Project }).value;
    expect(project.archiveFolderKey).toBeDefined();
    expect(context.folders.get(project.archiveFolderKey)).toMatchObject({ scopeKey, name: 'Apollo', deletedAt: null });
    expect(project.embedding.length).toBeGreaterThan(0);
    expect(context.audits.at(-1)).toMatchObject({ action: 'project.create', data: { success: true } });
  });

  test('rolls back project insertion when Archive folder creation fails', async () => {
    const context = harness();
    const original = context.repository.createArchiveFolder;
    context.repository.createArchiveFolder = async () => { throw new Error('folder failed'); };
    const result = await context.execute('project.create', { items: [{ scopeKey, name: 'Failure' }], atomic: true });
    expect(result.results![0]).toMatchObject({ success: false });
    expect(context.projects.size).toBe(0);
    expect(context.folders.size).toBe(0);
    context.repository.createArchiveFolder = original;
  });

  test('supports update, rename, move, archive, restore, and permanent cascade delete', async () => {
    const context = harness();
    const { project, milestone, task } = await createHierarchy(context);
    await context.execute('project.update', { items: [{ projectKey: project.key, description: 'Updated' }] });
    await context.execute('project.rename', { items: [{ projectKey: project.key, name: 'Artemis' }] });
    await context.execute('project.move', { items: [{ projectKey: project.key, scopeKey: otherScopeKey }] });
    expect(context.projects.get(project.key)).toMatchObject({ name: 'Artemis', description: 'Updated', scopeKey: otherScopeKey });
    expect(context.milestones.get(milestone.key)?.scopeKey).toBe(otherScopeKey);
    expect(context.tasks.get(task.key)?.scopeKey).toBe(otherScopeKey);
    await context.execute('project.archive', { items: [{ projectKey: project.key }] });
    expect(context.projects.get(project.key)?.deletedAt).toBe(timestamp);
    await context.execute('project.restore', { items: [{ projectKey: project.key }] });
    expect(context.projects.get(project.key)?.deletedAt).toBeNull();
    await context.execute('task.archive', { items: [{ taskKey: task.key }] });
    await context.execute('milestone.archive', { items: [{ milestoneKey: milestone.key }] });
    await context.execute('project.archive', { items: [{ projectKey: project.key }] });
    await context.execute('project.delete', { items: [{ projectKey: project.key }] });
    expect(context.projects.size).toBe(0);
    expect(context.milestones.size).toBe(0);
    expect(context.tasks.size).toBe(0);
    expect(context.folders.size).toBe(0);
  });

  test('clears optional descriptions and does not misreport committed writes when audit fails', async () => {
    const context = harness();
    const { project } = await createHierarchy(context);
    await context.execute('project.update', { items: [{ projectKey: project.key, description: null }] });
    expect(context.projects.get(project.key)).not.toHaveProperty('description');
    const result = await executeMomentumTool('project.rename', { items: [{ projectKey: project.key, name: 'Audit-safe' }], atomic: true }, {
      repository: context.repository, generateEmbedding: async () => [1], authorize: async () => undefined,
      audit: async () => { throw new Error('audit unavailable'); }, now: () => timestamp,
    });
    expect(result.results![0]).toMatchObject({ success: true });
    expect(context.projects.get(project.key)?.name).toBe('Audit-safe');
  });
});

describe('Milestone tools', () => {
  test('creates, schedules, reorders/moves, transitions, completes, reopens, archives, restores, and deletes', async () => {
    const context = harness();
    const { project, milestone } = await createHierarchy(context);
    await context.execute('milestone.schedule', { items: [{ milestoneKey: milestone.key, startDate: '2026-08-01', endDate: '2026-08-31' }] });
    await context.execute('milestone.update', { items: [{ milestoneKey: milestone.key, order: 2, description: 'Phase' }] });
    await context.execute('milestone.rename', { items: [{ milestoneKey: milestone.key, name: 'Launch phase' }] });
    await context.execute('milestone.change-status', { items: [{ milestoneKey: milestone.key, status: 'active' }] });
    await context.execute('milestone.complete', { items: [{ milestoneKey: milestone.key }] });
    expect(context.milestones.get(milestone.key)).toMatchObject({ status: 'completed', completedAt: timestamp, order: 2 });
    await context.execute('milestone.reopen', { items: [{ milestoneKey: milestone.key }] });
    expect(context.milestones.get(milestone.key)?.status).toBe('active');
    await context.execute('milestone.archive', { items: [{ milestoneKey: milestone.key }] });
    await context.execute('milestone.restore', { items: [{ milestoneKey: milestone.key }] });
    expect(context.milestones.get(milestone.key)?.deletedAt).toBeNull();
    const secondProject = (await context.execute('project.create', { items: [{ scopeKey, name: 'Gemini' }] })).results![0] as { success: true; value: Project };
    await context.execute('milestone.move', { items: [{ milestoneKey: milestone.key, projectKey: secondProject.value.key, order: 1 }] });
    expect(context.milestones.get(milestone.key)?.projectKey).toBe(secondProject.value.key);
    expect((await context.execute('milestone.list', { projectKey: secondProject.value.key, includeArchived: false })).items).toHaveLength(1);
    expect((await context.execute('milestone.find', { milestoneKeys: [milestone.key] })).items).toHaveLength(1);
    await context.execute('milestone.archive', { items: [{ milestoneKey: milestone.key }] });
    const child = [...context.tasks.values()][0]!;
    await context.execute('task.archive', { items: [{ taskKey: child.key }] });
    await context.execute('milestone.delete', { items: [{ milestoneKey: milestone.key }] });
    expect(context.milestones.has(milestone.key)).toBe(false);
  });
});

describe('Task tools', () => {
  test('supports update, rename, move, reorder, statuses, lifecycle, and delete', async () => {
    const context = harness();
    const { project, task } = await createHierarchy(context);
    const second = (await context.execute('milestone.create', { items: [{ projectKey: project.key, name: 'Landing', status: 'planned', order: 1 }] })).results![0] as { success: true; value: Milestone };
    await context.execute('task.update', { items: [{ taskKey: task.key, description: 'Detailed', priority: 'high' }] });
    await context.execute('task.rename', { items: [{ taskKey: task.key, title: 'Load fuel' }] });
    await context.execute('task.move', { items: [{ taskKey: task.key, milestoneKey: second.value.key, position: 3 }] });
    await context.execute('task.reorder', { items: [{ taskKey: task.key, position: 4 }] });
    await context.execute('task.change-status', { items: [{ taskKey: task.key, status: 'blocked' }] });
    await context.execute('task.complete', { items: [{ taskKey: task.key }] });
    await context.execute('task.reopen', { items: [{ taskKey: task.key }] });
    expect(context.tasks.get(task.key)).toMatchObject({ title: 'Load fuel', description: 'Detailed', milestoneKey: second.value.key, position: 4, status: 'todo' });
    expect((await context.execute('task.find', { taskKeys: [task.key] })).items).toHaveLength(1);
    expect((await context.execute('task.list', { projectKey: project.key, milestoneKey: second.value.key })).items).toHaveLength(1);
    await context.execute('task.archive', { items: [{ taskKey: task.key }] });
    await context.execute('task.restore', { items: [{ taskKey: task.key }] });
    await context.execute('task.archive', { items: [{ taskKey: task.key }] });
    await context.execute('task.delete', { items: [{ taskKey: task.key }] });
    expect(context.tasks.has(task.key)).toBe(false);
  });

  test('composes read and reason for summarize, translate, and rewrite with optional persistence', async () => {
    const context = harness();
    const { task } = await createHierarchy(context);
    const summary = await context.execute('task.summarize', { items: [{ taskKey: task.key, persist: false }] });
    const translation = await context.execute('task.translate', { items: [{ taskKey: task.key, language: 'Swedish', persist: false }] });
    const rewrite = await context.execute('task.rewrite', { items: [{ taskKey: task.key, instruction: 'Be concise', persist: true }] });
    expect((summary.results![0] as { success: true; value: { text: string } }).value.text).toBe('summarize:Fuel rocket');
    expect((translation.results![0] as { success: true; value: { text: string } }).value.text).toBe('translate:Swedish');
    expect(context.tasks.get(task.key)?.description).toBe('rewrite:Be concise');
    expect((rewrite.results![0] as { success: true; value: { persisted: boolean } }).value.persisted).toBe(true);
  });

  test('does not persist AI output over a task changed during reasoning', async () => {
    const context = harness();
    const { task } = await createHierarchy(context);
    context.setBeforeAtomic(() => { context.tasks.set(task.key, { ...context.tasks.get(task.key)!, title: 'Concurrent title', updatedAt: '2026-07-22T00:00:01.000Z' }); });
    const result = await context.execute('task.rewrite', { items: [{ taskKey: task.key, instruction: 'Be concise', persist: true }] });
    expect(result.results![0]).toMatchObject({ success: false });
    expect(context.tasks.get(task.key)).toMatchObject({ title: 'Concurrent title' });
    expect(context.tasks.get(task.key)).not.toHaveProperty('description');
  });
});

describe('Batch, authorization, search, and domain envelope', () => {
  test('supports one, many, partial failures, and atomic rollback with per-item responses', async () => {
    const context = harness();
    const partial = await context.execute('project.create', { items: [{ scopeKey, name: 'One' }, { scopeKey: otherScopeKey, name: 'Denied' }], atomic: false });
    expect(partial.results).toHaveLength(2);
    const denied = harness(otherScopeKey);
    const deniedPartial = await denied.execute('project.create', { items: [{ scopeKey, name: 'One' }, { scopeKey: otherScopeKey, name: 'Denied' }], atomic: false });
    expect(deniedPartial.results!.map(({ success }) => success)).toEqual([true, false]);
    const deniedAtomic = await denied.execute('project.create', { items: [{ scopeKey, name: 'Atomic' }, { scopeKey: otherScopeKey, name: 'Denied' }], atomic: true });
    expect(deniedAtomic.results!.every(({ success }) => !success)).toBe(true);
    expect([...denied.projects.values()].some(({ name }) => name === 'Atomic')).toBe(false);
    expect(denied.audits.length).toBeGreaterThan(0);
  });

  test('rejects duplicate atomic targets and scopes archived at the transaction boundary', async () => {
    const context = harness();
    const { project } = await createHierarchy(context);
    const duplicate = await context.execute('project.update', { items: [{ projectKey: project.key, name: 'First' }, { projectKey: project.key, description: 'Second' }], atomic: true });
    expect(duplicate.results!.every(({ success }) => !success)).toBe(true);
    expect((duplicate.results![0] as { success: false; error: { code: string } }).error.code).toBe('atomic_duplicate_target');
    expect(context.projects.get(project.key)).toMatchObject({ name: 'Apollo', description: 'Moon delivery' });

    context.setTransactionScopesActive(false);
    const archivedRace = await context.execute('project.rename', { items: [{ projectKey: project.key, name: 'Blocked' }], atomic: true });
    expect(archivedRace.results![0]).toMatchObject({ success: false, error: { code: 'scope_archived' } });
    expect(context.projects.get(project.key)?.name).toBe('Apollo');
  });

  test('revalidates hierarchy lifecycle state after the transaction lock is acquired', async () => {
    const context = harness();
    const { project, milestone } = await createHierarchy(context);
    context.setBeforeAtomic(() => { context.projects.set(project.key, { ...context.projects.get(project.key)!, deletedAt: timestamp }); });
    const result = await context.execute('task.create', { items: [{ milestoneKey: milestone.key, title: 'Too late' }], atomic: true });
    expect(result.results![0]).toMatchObject({ success: false, error: { code: 'project_archived' } });
    expect([...context.tasks.values()].some(({ title }) => title === 'Too late')).toBe(false);
    expect(context.projects.get(project.key)?.deletedAt).toBe(timestamp);
  });

  test('ranks semantic results, filters multiple sources, and enforces scope authorization', async () => {
    const context = harness();
    const { project, milestone, task } = await createHierarchy(context);
    const result = await context.execute('scope.project.search', { scopeKey, query: 'moon', sources: [{ type: 'project', projectKeys: [project.key] }, { type: 'task', taskKeys: [task.key] }], limit: 10 });
    expect(result.items?.map((item) => (item as { type: string }).type)).toEqual(expect.arrayContaining(['project', 'task']));
    expect(result.items?.some((item) => (item as { item: { key: string } }).item.key === milestone.key)).toBe(false);
    const denied = harness(scopeKey);
    await expect(denied.execute('scope.project.search', { scopeKey, query: 'x', sources: [], limit: 10 })).rejects.toThrow('forbidden');
    const organization = await context.execute('organization.project.search', { query: 'moon', scopeKeys: [scopeKey], sources: [], limit: 10 });
    expect(organization.items?.length).toBeGreaterThan(0);
  });

  test('executes a registered Momentum tool through the real domain result envelope', async () => {
    const context = harness();
    const principal = { kind: 'member' as const, user: { key: 'user' }, userOrganization: { key: 'membership', organizationId: 'org', status: 'active', orgRole: 'owner' } } as never;
    const result = await executeDomainTool('project.create', { items: [{ scopeKey, name: 'Envelope' }], atomic: true }, { organizationKey: 'org', runtimeScopeKey: scopeKey, principal }, {
      momentum: { repository: context.repository, createKey: () => `cmrnlzf64${String(context.projects.size).padStart(4, '0')}qc7k4p5zem5w`, now: () => timestamp, generateEmbedding: async () => [1], reason: async () => 'reason' },
      authorizeScope: async () => undefined,
      domainEvents: async () => undefined,
    });
    expect(result).toMatchObject({ action: 'project.create', status: 'completed', data: { action: 'project.create' } });
  });
});
