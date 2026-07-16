# Genesis Follow-Up — Required Tool, Action, Permissions and Guardrails

Update the Genesis Agent Architect implementation with the minimum executable capability required for Genesis to create agents.

Do not redesign the existing Genesis architecture.

Genesis should continue reasoning through:

```text
core.reason
→ GPT-5.4 Mini
→ OpenAI

Genesis must have exactly one callable Tool:

agent.create
1. Required Action

Add and seed this Action:

agent.create

Meaning:

Validate and transactionally create or reuse an agent architecture.

The Action must support:

reusing an existing agent,
creating a new agent,
reusing existing Skills,
creating necessary Skills,
creating agentSkills,
attaching existing Tools through agentTools,
recording source and result artifacts,
running novelty checks,
rejecting unresolved or forbidden references.

The Action must not allow Genesis to:

create Tools,
create Actions,
create Models,
create Providers,
enable organization Providers,
write arbitrary database documents.

Suggested action seed:

{
  "key": "cmgenesisactioncreateagent001",
  "slug": "agent.create",
  "name": "Create Agent",
  "description": "Validates and transactionally creates or reuses an agent, its required skills, skill relations, and allowed tool relations.",
  "objective": "Persist a complete validated agent architecture from a Genesis creation manifest.",
  "inputDescription": "A validated Genesis agent creation manifest containing an agent operation, skill operations, agent skill relations, and existing tools to attach.",
  "outputDescription": "The persisted or reused agent, created skills, linking nodes, provenance artifacts, and validation result.",
  "handlerKey": "agent.create",
  "enabled": true,
  "embedding": []
}

Embed:

name
description
objective
inputDescription
outputDescription
2. Required Tool

Add and seed exactly one Genesis Tool:

agent.create

The Tool maps only to:

agent.create

Flow:

Genesis
→ agent.create Tool
→ agent.create Action
→ Genesis creation service
→ validation
→ transaction
→ persisted agent architecture

Suggested Tool seed:

{
  "key": "cmgenesistoolcreateagent0001",
  "slug": "agent.create",
  "name": "Create Agent",
  "description": "Creates or reuses a complete agent architecture from a validated Genesis manifest.",
  "embedding": []
}

Suggested toolActions seed:

{
  "key": "cmgenesistoolactioncreate001",
  "toolSlug": "agent.create",
  "actionSlug": "agent.create",
  "priority": 100
}

Genesis must not receive separate Tools for:

skill.search
skill.create
agent.search
agentSkill.create
agentTool.create
artifact.create
database.write

Those operations are internal responsibilities of the agent.create backend handler.

3. Genesis Allowed Tools

Genesis must have exactly this allowed Tool list:

{
  "allowedTools": [
    "agent.create"
  ]
}

Seed or update agentTools:

{
  "key": "cmgenesisagenttoolcreate00001",
  "agentSlug": "genesis",
  "toolSlug": "agent.create"
}

Remove any direct write Tools accidentally assigned to Genesis.

core.reason is the reasoning Action used by runtime. It is not an unrestricted database Tool.

4. Tool Execution Input

agent.create must accept only a validated Genesis creation manifest.

export const createAgentToolInputSchema = z.object({
  organizationKey: z.string().cuid(),

  scopeKey: z.string().cuid(),

  agentRunKey: z.string().cuid(),

  manifest: genesisCreationManifestSchema,
});

The handler must parse the input again before performing any writes.

Never trust model output without backend validation.

5. Tool Execution Output
export const createAgentToolOutputSchema = z.object({
  status: z.enum([
    "created",
    "reused",
    "rejected",
  ]),

  agentKey: z
    .string()
    .cuid()
    .nullable(),

  createdSkillKeys: z
    .array(z.string().cuid()),

  reusedSkillKeys: z
    .array(z.string().cuid()),

  agentSkillKeys: z
    .array(z.string().cuid()),

  agentToolKeys: z
    .array(z.string().cuid()),

  artifactKeys: z
    .array(z.string().cuid()),

  reason: z
    .string()
    .trim()
    .min(1)
    .max(500),
});
6. Genesis Guardrails

Compile these guardrails into Genesis AgentContext:

export const genesisGuardrailsSchema = z.object({
  organizationKey: z.string().cuid(),

  scopeKey: z.string().cuid(),

  allowedToolSlugs: z.tuple([
    z.literal("agent.create"),
  ]),

  allowedActionSlugs: z.tuple([
    z.literal("agent.create"),
  ]),

  canCreateAgents: z.literal(true),

  canCreateSkills: z.literal(true),

  canCreateAgentSkills: z.literal(true),

  canCreateAgentTools: z.literal(true),

  canCreateTools: z.literal(false),

  canCreateActions: z.literal(false),

  canCreateModels: z.literal(false),

  canCreateProviders: z.literal(false),

  canEnableProviders: z.literal(false),

  canWriteArbitraryNodes: z.literal(false),

  requireExistingTools: z.literal(true),

  requireNoveltyValidation: z.literal(true),

  requireTransactionalWrite: z.literal(true),

  requireSameOrganization: z.literal(true),

  requireScopePermission: z.literal(true),
});
7. Mandatory Runtime Checks

Before executing agent.create, verify:

Genesis owns the agent.create Tool.
The Tool maps to the agent.create Action.
The current organization matches the manifest context.
The target scope belongs to that organization.
Genesis has permission to create agents in that scope.
Every reused Skill exists.
Every attached Tool already exists.
No requested Tool is outside the allowed registry.
New Agent and Skill candidates pass embedding similarity checks.
The manifest is marked readyToPersist.
The complete write can run transactionally.

Reject the execution if any check fails.

8. Transaction Boundary

The agent.create Action handler may transactionally write only to:

agents
skills
agentSkills
agentTools
agentArtifacts
agentArtifactChecks

It may read from:

organizations
scopes
agents
skills
tools
actions
toolActions
scopeMembers
agentRunSources

It must not write to:

tools
actions
models
providers
modelActions
modelProviders
organizationProviders
9. Artifact Rules

For every reused object:

agentArtifacts.relation = source

For every created object:

agentArtifacts.relation = result

Supported Genesis artifact node types:

agent
skill
agent-skill
tool
agent-tool
scope

Existing Tools and Skills are sources.

New Agents, Skills, agentSkills, and agentTools are results.

10. Final Genesis Execution Chain
User requests a new agent
↓
Genesis compiles AgentContext
↓
Genesis reasons through core.reason
↓
Genesis returns a creation manifest
↓
Backend validates the manifest
↓
Genesis invokes agent.create
↓
agent.create validates permissions and references
↓
Novelty checks run
↓
One transaction persists the architecture
↓
Artifacts record sources and results
↓
Agent Run completes

Genesis must never receive a generic database Tool.

Genesis must never perform arbitrary writes.

Genesis may only create agent architectures through:

agent.create