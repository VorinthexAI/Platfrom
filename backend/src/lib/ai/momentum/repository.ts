import { z } from 'zod';
import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { FOLDERS_COLLECTION, folderSchema, type Folder } from '@/lib/db/folders.node';
import { MILESTONES_COLLECTION, milestoneSchema, type Milestone } from '@/lib/db/milestones.node';
import { PROJECTS_COLLECTION, projectSchema, type Project } from '@/lib/db/projects.node';
import { TASKS_COLLECTION, taskSchema, type Task } from '@/lib/db/tasks.node';

const MOMENTUM_COLLECTIONS = [PROJECTS_COLLECTION, MILESTONES_COLLECTION, TASKS_COLLECTION, FOLDERS_COLLECTION] as const;
const listOptionsSchema = z.object({ includeDeleted: z.boolean().optional() }).strict();

export interface MomentumDatabase {
  query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }>;
}

export type MomentumTransactionRunner = <T>(
  collections: readonly string[],
  operation: (database: MomentumDatabase) => Promise<T>,
) => Promise<T>;

export interface MomentumListOptions {
  includeDeleted?: boolean;
}

export type ProjectUpdate = Partial<Omit<Project, 'key' | 'createdAt' | 'embedding'>> & Pick<Project, 'embedding' | 'updatedAt'>;
export type MilestoneUpdate = Partial<Omit<Milestone, 'key' | 'createdAt' | 'embedding'>> & Pick<Milestone, 'embedding' | 'updatedAt'>;
export type TaskUpdate = Partial<Omit<Task, 'key' | 'createdAt' | 'embedding'>> & Pick<Task, 'embedding' | 'updatedAt'>;

export interface MomentumRepository {
  createProject(project: Project): Promise<Project>;
  getProject(key: string): Promise<Project | null>;
  updateProject(key: string, patch: ProjectUpdate): Promise<Project>;
  deleteProject(key: string): Promise<void>;
  listProjects(scopeKey: string, options?: MomentumListOptions): Promise<Project[]>;
  listAllProjects(options?: MomentumListOptions): Promise<Project[]>;
  listProjectsByScopes(scopeKeys: string[], options?: MomentumListOptions): Promise<Project[]>;
  createMilestone(milestone: Milestone): Promise<Milestone>;
  getMilestone(key: string): Promise<Milestone | null>;
  updateMilestone(key: string, patch: MilestoneUpdate): Promise<Milestone>;
  deleteMilestone(key: string): Promise<void>;
  listMilestones(projectKey: string, options?: MomentumListOptions): Promise<Milestone[]>;
  createTask(task: Task): Promise<Task>;
  getTask(key: string): Promise<Task | null>;
  updateTask(key: string, patch: TaskUpdate): Promise<Task>;
  deleteTask(key: string): Promise<void>;
  listTasks(projectKey: string, options?: MomentumListOptions & { milestoneKey?: string }): Promise<Task[]>;
  createArchiveFolder(folder: Folder): Promise<Folder>;
  updateArchiveFolder(key: string, patch: Partial<Folder> & Pick<Folder, 'embedding' | 'updatedAt'>): Promise<Folder>;
  deleteArchiveFolder(key: string): Promise<void>;
  withAtomic<T>(operation: (repository: MomentumRepository) => Promise<T>): Promise<T>;
}

const defaultTransactionRunner: MomentumTransactionRunner = (collections, operation) =>
  withTransaction([...collections], (transaction) => operation(transaction));

export function createMomentumRepository(
  database: MomentumDatabase = db,
  runTransaction: MomentumTransactionRunner = defaultTransactionRunner,
): MomentumRepository {
  async function insert<Schema extends z.ZodTypeAny>(
    collection: string,
    schema: Schema,
    input: z.output<Schema>,
  ): Promise<z.output<Schema>> {
    requireSuppliedEmbedding(input);
    const document = schema.parse(input);
    const cursor = await database.query(
      'INSERT @document IN @@collection RETURN NEW',
      { '@collection': collection, document: toArangoDoc(document as Record<string, unknown> & { key: string }) },
    );
    const [saved] = await cursor.all();
    return schema.parse(withArangoKey(saved as Record<string, unknown>));
  }

  async function get<Schema extends z.ZodTypeAny>(
    collection: string,
    schema: Schema,
    keySchema: z.ZodType<string>,
    key: string,
  ): Promise<z.output<Schema> | null> {
    const validKey = keySchema.parse(key);
    const cursor = await database.query(
      'FOR document IN @@collection FILTER document._key == @key LIMIT 1 RETURN document',
      { '@collection': collection, key: validKey },
    );
    const [document] = await cursor.all();
    return document ? schema.parse(withArangoKey(document as Record<string, unknown>)) : null;
  }

  async function update<Schema extends z.ZodTypeAny>(
    collection: string,
    schema: Schema,
    keySchema: z.ZodType<string>,
    key: string,
    patch: Record<string, unknown>,
  ): Promise<z.output<Schema>> {
    requireSuppliedEmbedding(patch);
    const validKey = keySchema.parse(key);
    const current = await get(collection, schema, keySchema, validKey);
    if (!current) throw new MomentumDocumentNotFoundError(collection, validKey);
    const parsed = schema.parse({ ...current, ...patch });
    const { key: _key, ...replacement } = parsed as Record<string, unknown> & { key: string };
    for (const [field, value] of Object.entries(replacement)) if (value === undefined) delete replacement[field];
    const cursor = await database.query(
      'REPLACE @key WITH @document IN @@collection RETURN NEW',
      { '@collection': collection, key: validKey, document: replacement },
    );
    const [saved] = await cursor.all();
    if (!saved) throw new MomentumDocumentNotFoundError(collection, validKey);
    return schema.parse(withArangoKey(saved as Record<string, unknown>));
  }

  async function remove(collection: string, keySchema: z.ZodType<string>, key: string): Promise<void> {
    const validKey = keySchema.parse(key);
    await database.query(
      'REMOVE @key IN @@collection OPTIONS { ignoreErrors: false }',
      { '@collection': collection, key: validKey },
    );
  }

  async function list<Schema extends z.ZodTypeAny>(
    collection: string,
    schema: Schema,
    ownerField: 'scopeKey' | 'projectKey',
    ownerKey: string,
    options?: MomentumListOptions,
    milestoneKey?: string,
  ): Promise<z.output<Schema>[]> {
    const validOptions = listOptionsSchema.parse(options ?? {});
    const cursor = await database.query(
      `FOR document IN @@collection
         FILTER document[@ownerField] == @ownerKey
           && (@includeDeleted || document.deletedAt == null)
           && (@milestoneKey == null || document.milestoneKey == @milestoneKey)
         SORT document.createdAt ASC, document._key ASC
         RETURN document`,
      {
        '@collection': collection,
        ownerField,
        ownerKey: projectSchema.shape.scopeKey.parse(ownerKey),
        includeDeleted: validOptions.includeDeleted ?? false,
        milestoneKey: milestoneKey ? taskSchema.shape.milestoneKey.parse(milestoneKey) : null,
      },
    );
    const documents = await cursor.all();
    return (documents as Record<string, unknown>[]).map((document) => schema.parse(withArangoKey(document)));
  }

  async function listAll<Schema extends z.ZodTypeAny>(collection: string, schema: Schema, options?: MomentumListOptions): Promise<z.output<Schema>[]> {
    const validOptions = listOptionsSchema.parse(options ?? {});
    const cursor = await database.query(
      'FOR document IN @@collection FILTER @includeDeleted || document.deletedAt == null SORT document.createdAt ASC, document._key ASC RETURN document',
      { '@collection': collection, includeDeleted: validOptions.includeDeleted ?? false },
    );
    return (await cursor.all() as Record<string, unknown>[]).map((document) => schema.parse(withArangoKey(document)));
  }

  async function listProjectsByScopes(scopeKeys: string[], options?: MomentumListOptions): Promise<Project[]> {
    const validOptions = listOptionsSchema.parse(options ?? {});
    const keys = z.array(projectSchema.shape.scopeKey).max(1_000).parse(scopeKeys);
    const cursor = await database.query(
      'FOR project IN projects FILTER project.scopeKey IN @scopeKeys && (@includeDeleted || project.deletedAt == null) SORT project.createdAt ASC, project._key ASC RETURN project',
      { scopeKeys: keys, includeDeleted: validOptions.includeDeleted ?? false },
    );
    return (await cursor.all() as Record<string, unknown>[]).map((project) => projectSchema.parse(withArangoKey(project)));
  }

  const repository: MomentumRepository = {
    createProject: (project) => insert(PROJECTS_COLLECTION, projectSchema, project),
    getProject: (key) => get(PROJECTS_COLLECTION, projectSchema, projectSchema.shape.key, key),
    updateProject: (key, patch) => update(PROJECTS_COLLECTION, projectSchema, projectSchema.shape.key, key, patch),
    deleteProject: (key) => remove(PROJECTS_COLLECTION, projectSchema.shape.key, key),
    listProjects: (scopeKey, options) => list(PROJECTS_COLLECTION, projectSchema, 'scopeKey', scopeKey, options),
    listAllProjects: (options) => listAll(PROJECTS_COLLECTION, projectSchema, options),
    listProjectsByScopes,
    createMilestone: (milestone) => insert(MILESTONES_COLLECTION, milestoneSchema, milestone),
    getMilestone: (key) => get(MILESTONES_COLLECTION, milestoneSchema, milestoneSchema.shape.key, key),
    updateMilestone: (key, patch) => update(MILESTONES_COLLECTION, milestoneSchema, milestoneSchema.shape.key, key, patch),
    deleteMilestone: (key) => remove(MILESTONES_COLLECTION, milestoneSchema.shape.key, key),
    listMilestones: (projectKey, options) => list(MILESTONES_COLLECTION, milestoneSchema, 'projectKey', projectKey, options),
    createTask: (task) => insert(TASKS_COLLECTION, taskSchema, task),
    getTask: (key) => get(TASKS_COLLECTION, taskSchema, taskSchema.shape.key, key),
    updateTask: (key, patch) => update(TASKS_COLLECTION, taskSchema, taskSchema.shape.key, key, patch),
    deleteTask: (key) => remove(TASKS_COLLECTION, taskSchema.shape.key, key),
    listTasks: (projectKey, options = {}) => {
      const { milestoneKey, ...listOptions } = options;
      return list(TASKS_COLLECTION, taskSchema, 'projectKey', projectKey, listOptions, milestoneKey);
    },
    createArchiveFolder: (folder) => insert(FOLDERS_COLLECTION, folderSchema, folder),
    updateArchiveFolder: (key, patch) => update(FOLDERS_COLLECTION, folderSchema, folderSchema.shape.key, key, patch),
    deleteArchiveFolder: (key) => remove(FOLDERS_COLLECTION, folderSchema.shape.key, key),
    withAtomic: (operation) => runTransaction(MOMENTUM_COLLECTIONS, (transaction) =>
      operation(createMomentumRepository(transaction, runTransaction))),
  };

  return repository;
}

function requireSuppliedEmbedding(input: unknown): void {
  if (typeof input !== 'object' || input === null || !Object.prototype.hasOwnProperty.call(input, 'embedding')) {
    throw new Error('Momentum repository writes require a precomputed embedding.');
  }
}

export class MomentumDocumentNotFoundError extends Error {
  constructor(collection: string, key: string) {
    super(`${collection} document not found: ${key}`);
    this.name = 'MomentumDocumentNotFoundError';
  }
}

let defaultRepository: MomentumRepository | null = null;

export function getDefaultMomentumRepository(): MomentumRepository {
  defaultRepository ??= createMomentumRepository();
  return defaultRepository;
}
