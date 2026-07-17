import { describe, expect, test } from 'bun:test';
import { AGENTS_COLLECTION, agentSchema } from '@/lib/db/agents.node';
import { SKILLS_COLLECTION } from '@/lib/db/skills.node';
import { AGENT_SKILLS_COLLECTION, agentSkillSchema } from '@/lib/db/agent-skills.node';
import { AGENT_TOOLS_COLLECTION, agentToolSchema } from '@/lib/db/agent-tools.node';
import { ACTIONS_COLLECTION } from '@/lib/db/actions.node';
import { PROVIDERS_COLLECTION } from '@/lib/db/providers.node';
import { MODELS_COLLECTION } from '@/lib/db/models.node';
import { MODEL_ACTIONS_COLLECTION, modelActionSchema } from '@/lib/db/model-actions.node';
import { MODEL_PROVIDERS_COLLECTION, modelProviderSchema } from '@/lib/db/model-providers.node';
import { TOOLS_COLLECTION } from '@/lib/db/tools.node';
import { TOOL_ACTIONS_COLLECTION, toolActionSchema } from '@/lib/db/tool-actions.node';
import { USER_ORGANIZATION_COLLECTION, userOrganizationSchema } from '@/lib/db/user-organization.node';
import { ORGANIZATIONS_COLLECTION } from '@/lib/db/organizations.node';
import { USERS_COLLECTION } from '@/lib/db/users.node';
import {
  SCOPES_COLLECTION,
  SCOPE_MEMBERS_COLLECTION,
  SCOPE_SCOPES_COLLECTION,
  SCOPE_MEMBER_ROLES,
  scopeMemberSchema,
  scopeScopeSchema,
} from './scopes';
import { ORGANIZATION_PROVIDERS_COLLECTION, organizationProviderSchema } from './organization-providers';
import { AGENT_RUNS_COLLECTION, agentRunSchema } from './agent-runs';
import { AGENT_RUN_STEPS_COLLECTION } from './agent-run-steps';
import { AGENT_RUN_CALLS_COLLECTION } from './agent-run-calls';
import { AGENT_ARTIFACTS_COLLECTION } from './agent-artifacts';
import { AGENT_MEMORIES_COLLECTION } from './agent-memories';
import { AGENT_RUN_SOURCES_COLLECTION } from './agent-run-sources';
import { AGENT_ARTIFACT_CHECKS_COLLECTION } from './agent-artifact-checks';
import { RUNTIME_VARIABLES_COLLECTION } from './runtime-variables';
import { AGENT_ARCHITECTURE, AGENT_EXECUTION_SEQUENCE } from './architecture';

describe('AI metadata model contract', () => {
  test('uses the canonical collection names', () => {
    expect([
      USERS_COLLECTION, ORGANIZATIONS_COLLECTION, USER_ORGANIZATION_COLLECTION,
      SCOPES_COLLECTION, SCOPE_SCOPES_COLLECTION, SCOPE_MEMBERS_COLLECTION,
      SKILLS_COLLECTION, AGENTS_COLLECTION, AGENT_SKILLS_COLLECTION, AGENT_TOOLS_COLLECTION,
      ACTIONS_COLLECTION, PROVIDERS_COLLECTION, MODELS_COLLECTION,
      MODEL_ACTIONS_COLLECTION, MODEL_PROVIDERS_COLLECTION, ORGANIZATION_PROVIDERS_COLLECTION,
      TOOLS_COLLECTION, TOOL_ACTIONS_COLLECTION, AGENT_RUNS_COLLECTION,
      AGENT_RUN_STEPS_COLLECTION, AGENT_RUN_CALLS_COLLECTION,
      AGENT_ARTIFACTS_COLLECTION, AGENT_RUN_SOURCES_COLLECTION,
      AGENT_ARTIFACT_CHECKS_COLLECTION, AGENT_MEMORIES_COLLECTION,
      RUNTIME_VARIABLES_COLLECTION,
    ]).toEqual([
      'users', 'organizations', 'userOrganizations',
      'scopes', 'scopeScopes', 'scopeMembers',
      'skills', 'agents', 'agentSkills', 'agentTools',
      'actions', 'providers', 'models',
      'modelActions', 'modelProviders', 'organizationProviders',
      'tools', 'toolActions', 'agentRuns',
      'agentRunSteps', 'agentRunCalls', 'agentArtifacts', 'agentRunSources',
      'agentArtifactChecks', 'agentMemories', 'runtimeVariables',
    ]);
  });

  test('relations point at the intended metadata entities', () => {
    expect(Object.keys(userOrganizationSchema.shape)).toEqual(expect.arrayContaining(['organizationId', 'userId']));
    expect(Object.keys(scopeScopeSchema.innerType().shape)).toEqual(expect.arrayContaining(['parentKey', 'childKey']));
    expect(Object.keys(scopeMemberSchema.shape)).toEqual(expect.arrayContaining(['scopeKey', 'userOrganizationKey', 'role']));
    expect(agentSchema.shape).toHaveProperty('scopeKey');
    expect(Object.keys(agentSkillSchema.shape)).toEqual(expect.arrayContaining(['agentKey', 'skillKey', 'priority']));
    expect(Object.keys(agentToolSchema.shape)).toEqual(expect.arrayContaining(['agentKey', 'toolKey']));
    expect(Object.keys(modelActionSchema.shape)).toEqual(expect.arrayContaining(['modelKey', 'actionKey']));
    expect(Object.keys(modelProviderSchema.shape)).toEqual(expect.arrayContaining(['modelKey', 'providerKey']));
    expect(Object.keys(organizationProviderSchema.shape)).toEqual(expect.arrayContaining(['organizationKey', 'providerKey']));
    expect(Object.keys(toolActionSchema.shape)).toEqual(expect.arrayContaining(['toolKey', 'actionKey']));
    expect(agentRunSchema).toBeDefined();
  });

  test('scope membership uses the agreed roles', () => {
    expect(SCOPE_MEMBER_ROLES).toEqual(['owner', 'admin', 'moderator', 'viewer']);
  });

  test('locks the complete organization, registry, runtime, execution, and history layers', () => {
    expect(AGENT_ARCHITECTURE.organization).toEqual({ users: 'users', scopes: 'scopes', enabledProviders: 'organizationProviders', agentRuns: 'agentRuns' });
    expect(AGENT_ARCHITECTURE.registries).toEqual({ agents: 'agents', skills: 'skills', tools: 'tools', actions: 'actions', models: 'models', providers: 'providers' });
    expect(AGENT_ARCHITECTURE.linkingNodes).toEqual({ userOrganizations: 'userOrganizations', scopeScopes: 'scopeScopes', scopeMembers: 'scopeMembers', agentSkills: 'agentSkills', agentTools: 'agentTools', toolActions: 'toolActions', modelActions: 'modelActions', modelProviders: 'modelProviders', agentRunSources: 'agentRunSources' });
    expect(AGENT_ARCHITECTURE.runtime.agentContext).toEqual(['organization', 'scope', 'agent', 'skills', 'tools', 'knowledge', 'permissions', 'guardrails', 'currentTask']);
    expect(AGENT_ARCHITECTURE.execution).toEqual(['tool', 'action', 'router', 'model', 'provider']);
    expect(AGENT_ARCHITECTURE.response).toBe('response');
    expect(AGENT_ARCHITECTURE.executionHistory).toEqual({ agentRun: 'agentRuns', agentRunSteps: 'agentRunSteps', agentRunCalls: 'agentRunCalls', agentArtifacts: 'agentArtifacts', agentArtifactChecks: 'agentArtifactChecks', agentMemories: 'agentMemories' });
    expect(AGENT_EXECUTION_SEQUENCE).toEqual(['agentContext', 'tool', 'action', 'router', 'model', 'provider', 'response', 'agentRun', 'agentRunSteps', 'agentRunCalls']);
  });
});
