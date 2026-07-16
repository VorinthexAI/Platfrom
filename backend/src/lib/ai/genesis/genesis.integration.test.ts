import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { actionSchema } from '@/lib/db/actions.node';
import { modelSchema } from '@/lib/db/models.node';
import { providerSchema } from '@/lib/db/providers.node';
import { modelActionSchema } from '@/lib/db/model-actions.node';
import { modelProviderSchema } from '@/lib/db/model-providers.node';
import { agentRunSchema, type AgentRun, type AgentRunRepository } from '@/lib/ai/agent-runs';
import { agentRunStepSchema, type AgentRunStep, type AgentRunStepRepository } from '@/lib/ai/agent-run-steps';
import { agentRunCallSchema, type AgentRunCall, type AgentRunCallRepository } from '@/lib/ai/agent-run-calls';
import { agentRunSourceSchema, type AgentRunSource, type AgentRunSourceRepository } from '@/lib/ai/agent-run-sources';
import { agentArtifactSchema, type AgentArtifact, type AgentArtifactRepository } from '@/lib/ai/agent-artifacts';
import { agentArtifactCheckSchema, type AgentArtifactCheck, type AgentArtifactCheckRepository } from '@/lib/ai/agent-artifact-checks';
import type { RouterDataSource } from '@/lib/ai/router';
import type { ProviderExecuteRequest } from '@/lib/ai/providers';
import { tokenUsage } from '@/lib/ai/shared';
import type { GenesisTransactionGateway } from './persistence';
import { createAgentFromGenesis } from './execute';
import { GENESIS_STEP_SLUGS } from './schemas';
import { buildGenesisFixture } from './test-fixtures';
import type { RuntimeEventInput } from '@/platform/events';

describe('Genesis end-to-end runtime', () => {
  test('routes through Mini/OpenAI, validates, persists atomically, and exposes the complete ledger', async () => {
    const f = buildGenesisFixture(); const now = f.now;
    const model = modelSchema.parse({ key: newId(), slug: 'openai.gpt-5.4-mini', name: 'GPT-5.4 Mini', description: 'Reasoning model', supportedUseCases: 'Reason', enabled: true });
    const provider = providerSchema.parse({ key: newId(), slug: 'openai', name: 'OpenAI', description: 'Provider', supportedUseCases: 'AI', handlerKey: 'openai', enabled: true });
    const modelAction = modelActionSchema.parse({ key: newId(), modelKey: model.key, actionKey: f.reasonAction.key, priority: 100, enabled: true });
    const modelProvider = modelProviderSchema.parse({ key: newId(), modelKey: model.key, providerKey: provider.key, providerModelId: 'gpt-5.4-mini', enabled: true });
    const routerData: RouterDataSource = {
      async getActionBySlug(slug) { return slug === 'core.reason' ? actionSchema.parse(f.reasonAction) : null; }, async getModelBySlug(slug) { return slug === model.slug ? model : null; }, async getModelByKey(key) { return key === model.key ? model : null; },
      async getProviderBySlug(slug) { return slug === provider.slug ? provider : null; }, async getProviderByKey(key) { return key === provider.key ? provider : null; }, async listModelActions() { return [modelAction]; }, async listModelProviders() { return [modelProvider]; }, async listOrganizationProviderKeys() { return [provider.key]; },
    };
    const manifest = {
      metadata: { status: 'accepted', reason: 'Valid reusable agent architecture found', score: 0.96 },
      agent: { operation: 'create', slug: 'forge', name: 'Forge', title: 'Backend Developer', scopeKey: f.scope.key, explorationRate: 0.2 },
      skills: [{ operation: 'reuse', skillKey: f.backend.key, priority: 100 }], agentSkills: [{ skillRef: { type: 'existing', skillKey: f.backend.key }, priority: 100 }],
      agentTools: [{ operation: 'attach', toolKey: f.reasonTool.key, reason: 'Required reasoning capability' }], steps: [...GENESIS_STEP_SLUGS],
      validation: { scopeExists: true, agentIsUnique: true, allSkillsResolved: true, allToolsResolved: true, permissionsValid: true, noveltyValidated: true, readyToPersist: true, missingToolSlugs: [], warnings: [] },
    };
    const adapterRequests: ProviderExecuteRequest[] = [];
    const adapters = { openai: { id: 'openai' as const, name: 'OpenAI', async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) { adapterRequests.push(request as ProviderExecuteRequest); return { output: manifest as TOutput, usage: tokenUsage(20, 10), providerId: 'openai' as const, modelId: request.modelId, externalModelId: request.externalModelId }; } } };

    const runsStore: AgentRun[] = []; const stepsStore: AgentRunStep[] = []; const callsStore: AgentRunCall[] = []; const sourcesStore: AgentRunSource[] = []; const artifactsStore: AgentArtifact[] = []; const checksStore: AgentArtifactCheck[] = [];
    const runs: AgentRunRepository = { async insertRun(input) { const value = agentRunSchema.parse({ ...input, key: newId(), createdAt: now }); runsStore.push(value); return value; }, async updateRun(key, input) { const index = runsStore.findIndex((item) => item.key === key); const value = agentRunSchema.parse({ ...runsStore[index]!, ...input }); runsStore[index] = value; return value; }, async getRunById(key) { return runsStore.find((item) => item.key === key) ?? null; }, async listRunsForOrganization() { return runsStore; } };
    const steps: AgentRunStepRepository = { async insertStep(input) { const value = agentRunStepSchema.parse({ ...input, key: input.key ?? newId() }); stepsStore.push(value); return value; }, async listStepsForRun(key) { return stepsStore.filter((item) => item.agentRunKey === key); } };
    const calls: AgentRunCallRepository = { async insertCall(input) { const value = agentRunCallSchema.parse({ ...input, key: input.key ?? newId() }); callsStore.push(value); return value; }, async listCallsForRun(key) { return callsStore.filter((item) => item.agentRunKey === key); } };
    const sources: AgentRunSourceRepository = { async insertSource(input) { const value = agentRunSourceSchema.parse({ ...input, key: input.key ?? newId() }); sourcesStore.push(value); return value; }, async listSourcesForRun(key) { return sourcesStore.filter((item) => item.agentRunKey === key); } };
    const artifacts: AgentArtifactRepository = { async insertArtifact(input) { const value = agentArtifactSchema.parse({ ...input, key: input.key ?? newId() }); artifactsStore.push(value); return value; }, async listArtifactsForRun(key) { return artifactsStore.filter((item) => item.agentRunKey === key); } };
    const checks: AgentArtifactCheckRepository = { async insertCheck(input) { const value = agentArtifactCheckSchema.parse({ ...input, key: input.key ?? newId(), createdAt: input.createdAt ?? now }); checksStore.push(value); return value; }, async listChecksForRun(key) { return checksStore.filter((item) => item.agentRunKey === key); } };
    const transactionRows = new Map<string, Record<string, unknown>[]>();
    const runtimeEvents: RuntimeEventInput[] = [];
    const transaction: GenesisTransactionGateway = { async execute(callback) { const staged = new Map<string, Record<string, unknown>[]>(); const result = await callback({ async save(collection, document) { const rows = staged.get(collection) ?? []; rows.push(document); staged.set(collection, rows); } }); for (const [key, rows] of staged) transactionRows.set(key, rows); return result; } };

    const result = await createAgentFromGenesis({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create a Backend Developer agent.', sourceRefs: [{ nodeType: 'skill', nodeKey: f.backend.key, priority: 100 }] }, { ...f, data: routerData, adapters, runs, steps, calls, sources, artifacts, checks, events: async (event) => { runtimeEvents.push(event); }, transaction, generateEmbedding: async () => [1, 0] });
    expect(result.persisted).toBe(true); expect(result.manifest.agent).toMatchObject({ operation: 'create', slug: 'forge' });
    expect(result.context.tools.map(({ tool }) => tool.slug)).toEqual(['agent.create']);
    expect(result.toolOutput).toMatchObject({ status: 'created', agentKey: result.created?.agent.key, reusedSkillKeys: [f.backend.key] });
    expect(adapterRequests[0]).toMatchObject({ modelId: model.slug, externalModelId: 'gpt-5.4-mini', actionId: 'core.reason' });
    expect(runsStore[0]?.status).toBe('completed'); expect(stepsStore.map((step) => step.stepSlug)).toEqual([...GENESIS_STEP_SLUGS]);
    expect(callsStore[0]).toMatchObject({ toolKey: f.createTool.key, actionKey: f.reasonAction.key, modelKey: model.key, providerKey: provider.key, totalTokens: 30 });
    expect(sourcesStore[0]).toMatchObject({ nodeType: 'skill', nodeKey: f.backend.key });
    expect(artifactsStore[0]).toMatchObject({ nodeType: 'skill', nodeKey: f.backend.key, relation: 'source' });
    expect(checksStore[0]?.candidateNodeType).toBe('agent');
    expect(transactionRows.get('agents')).toHaveLength(1); expect(transactionRows.get('scopeAgents')).toHaveLength(1); expect(transactionRows.get('agentSkills')).toHaveLength(1); expect(transactionRows.get('agentTools')).toHaveLength(1);
    expect(result.created?.artifacts.some((artifact) => artifact.relation === 'result')).toBe(true);
    expect(runtimeEvents.filter(({ slug }) => slug === 'artifact.created')).toHaveLength(result.created?.artifacts.filter(({ relation }) => relation === 'result').length ?? 0);
    expect(runtimeEvents.every(({ scopeId }) => scopeId === f.scope.key)).toBe(true);
  });
});
