/** Canonical, runtime-inspectable contract for the complete agent architecture. */
export const AGENT_ARCHITECTURE = {
  organization: {
    users: 'users',
    scopes: 'scopes',
    enabledProviders: 'organizationProviders',
    agentRuns: 'agentRuns',
  },
  registries: {
    agents: 'agents',
    skills: 'skills',
    actions: 'actions',
    models: 'models',
    providers: 'providers',
  },
  linkingNodes: {
    userOrganizations: 'userOrganizations',
    scopeScopes: 'scopeScopes',
    scopeMembers: 'scopeMembers',
    scopeAgents: 'scopeAgents',
    agentMembers: 'agentMembers',
    agentSkills: 'agentSkills',
    modelActions: 'modelActions',
    modelProviders: 'modelProviders',
    agentRunSources: 'agentRunSources',
  },
  runtime: {
    agentContext: [
      'organization',
      'scope',
      'agent',
      'skills',
      'knowledge',
      'guardrails',
      'currentTask',
    ],
  },
  execution: ['action', 'router', 'model', 'provider'],
  response: 'response',
  artifactViews: {
    definitions: 'artifacts',
    snapshots: 'artifactSnapshots',
    dependencies: 'artifactDependencies',
  },
  executionHistory: {
    agentRun: 'agentRuns',
    agentRunSteps: 'agentRunSteps',
    agentRunCalls: 'agentRunCalls',
    agentArtifacts: 'agentArtifacts',
    agentArtifactChecks: 'agentArtifactChecks',
    agentMemories: 'agentMemories',
  },
} as const;

export const AGENT_EXECUTION_SEQUENCE = [
  'agentContext',
  'action',
  'router',
  'model',
  'provider',
  'response',
  'agentRun',
  'agentRunSteps',
  'agentRunCalls',
] as const;
