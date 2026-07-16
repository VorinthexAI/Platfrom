Implement the Vorinthex backend architecture described in this document.

This is a unified specification for:

- users
- organizations
- userOrganizations
- scopes
- scopeScopes
- scopeMembers
- actions
- providers
- models
- modelActions
- modelProviders
- organizationProviders
- router
- tools integration
- skills
- agents
- agentSkills
- agentRuns
- agentRunSteps
- agentRunCalls
- agentArtifacts
- agentMemories

Do not add speculative layers that are not described here.

Use the existing repository structure and conventions where possible.

Use:

- TypeScript strict mode
- Zod
- ArangoDB
- CUID for every persisted `key`
- lowerCamelCase for collection names
- kebab-case for ordinary slugs
- dot notation for action slugs
- `index.ts` as the public export file inside each module
- parameterized AQL
- deterministic behavior
- small modules
- no `any`
- `unknown` at external boundaries
- runtime validation before persistence
## 1. Core Mental Model


The entire runtime should follow this chain:

```text
User
→ Organization
→ Scope
→ Agent
→ Skill
→ Tool
→ Action
→ Router
→ Model
→ Provider
→ Result
```

Execution history is stored separately:

```text
agentRuns
├── agentRunSteps
├── agentRunCalls
├── agentArtifacts
└── agentMemories
```

Definitions live in registry nodes.

Relationships live in linking nodes.

Runtime state lives in execution nodes.

Do not duplicate relation data inside registry nodes when a linking node exists.
## 2. Global Data Rules

- Every persisted node must use `key: z.string().cuid()`.
- Use `key`, never `_key`, in the domain schema.
- The repository layer may map `key` to ArangoDB `_key` internally.
- Every embedding field is exactly `number[]`.
- Do not store embedding metadata inside the node.
- Only natural-language text should be embedded.
- Do not embed keys, slugs, enums, booleans, relations, timestamps, priorities, token counts, or other numbers.
- Seed files should use human-readable slugs for relationships.
- Seeders must resolve slugs to persisted CUID keys before writing linking nodes.
- Registry slugs must be unique.
- Linking nodes must use unique compound indexes.
- All timestamps must use ISO-8601 strings.
- All elapsed values must use integer milliseconds.
- All token counts must use non-negative integers.
- Avoid storing the same fact in multiple collections.

## 3. Suggested Backend Module Structure


Use a structure similar to:

```text
lib/
└── backend/
    ├── identity/
    │   ├── users/
    │   ├── organizations/
    │   └── user-organizations/
    │
    ├── scopes/
    │   ├── scopes/
    │   ├── scope-scopes/
    │   └── scope-members/
    │
    ├── ai/
    │   ├── actions/
    │   ├── providers/
    │   ├── models/
    │   ├── model-actions/
    │   ├── model-providers/
    │   ├── organization-providers/
    │   ├── router/
    │   └── tools/
    │
    ├── agents/
    │   ├── skills/
    │   ├── agents/
    │   ├── agent-skills/
    │   └── runtime/
    │       ├── agent-runs/
    │       ├── agent-run-steps/
    │       ├── agent-run-calls/
    │       ├── agent-artifacts/
    │       └── agent-memories/
    │
    └── index.ts
```

Each module should normally include:

```text
schema.ts
types.ts
repository.ts
service.ts
indexes.ts
seed.ts or seed.json
index.ts
```

Provider and router modules may include additional implementation files.
## 4. Users and Organizations


Assume `users`, `organizations`, and `userOrganizations` already exist or implement them according to repository conventions.

The important relationship is:

```text
users
→ userOrganizations
→ organizations
```

A user can belong to many organizations.

An organization can have many users.

Scope membership must reference `userOrganizationKey`, not `userKey`.
## 5. Scopes


Scopes represent product or workspace areas inside an organization.

Examples:

```text
Vorinthex AI
├── Core
├── Command
├── Studio
├── Launch
├── HQ
├── Replica
└── Pilot
```

A scope belongs to exactly one organization.

The scope hierarchy is stored separately in `scopeScopes`.
### 5.1 scopes Schema


```ts
import { z } from "zod";

export const scopeSchema = z.object({
  key: z.string().cuid(),

  organizationKey: z.string().cuid(),

  slug: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Scope slug must use lowercase kebab-case",
    ),

  name: z
    .string()
    .trim()
    .min(1)
    .max(160),

  description: z
    .string()
    .trim()
    .min(1)
    .max(4000),

  embedding: z
    .array(z.number().finite())
    .default([]),
});

export type Scope = z.infer<typeof scopeSchema>;
```
Embed these scope fields:
- `name`
- `description`

Create a unique persistent index on:
- `organizationKey + slug`

### 5.2 scopeScopes


`scopeScopes` builds the parent-child hierarchy.

```ts
export const scopeScopeSchema = z
  .object({
    key: z.string().cuid(),

    parentScopeKey: z.string().cuid(),

    childScopeKey: z.string().cuid(),

    position: z
      .number()
      .int()
      .positive(),
  })
  .superRefine((value, ctx) => {
    if (value.parentScopeKey === value.childScopeKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["childScopeKey"],
        message: "A scope cannot be its own parent",
      });
    }
  });

export type ScopeScope = z.infer<typeof scopeScopeSchema>;
```
Rules:
- Parent and child must exist.
- Parent and child must belong to the same organization.
- A child may have only one parent in v1.
- Cycles must be rejected.
- `position` starts at 1.
- `position` must be unique among siblings.

Create unique indexes on:
- `parentScopeKey + childScopeKey`
- `childScopeKey`
- `parentScopeKey + position`

### 5.3 scopeMembers


`scopeMembers` assigns organization members to scopes.

```ts
export const SCOPE_MEMBER_ROLES = [
  "owner",
  "admin",
  "moderator",
  "viewer",
] as const;

export const scopeMemberRoleSchema =
  z.enum(SCOPE_MEMBER_ROLES);

export const scopeMemberSchema = z.object({
  key: z.string().cuid(),

  scopeKey: z.string().cuid(),

  userOrganizationKey: z.string().cuid(),

  role: scopeMemberRoleSchema,
});

export type ScopeMember =
  z.infer<typeof scopeMemberSchema>;
```
Create a unique index on:
- `scopeKey + userOrganizationKey`

To resolve a member name:


```text
scopeMembers.userOrganizationKey
→ userOrganizations.key
→ userOrganizations.userKey
→ users.key
→ users.name
```
## 6. Actions Registry


Actions describe what the platform wants to do.

They do not know about models or providers.

Use dot notation:

```text
<domain>.<action>
```

The initial 16 action slugs are:

```ts
export const ACTION_IDS = [
  "core.ask",
  "core.reason",

  "web.search",
  "web.deep-research",

  "image.generate",
  "image.edit",
  "image.create-slideshow",

  "video.generate",
  "video.edit",
  "video.extend",
  "video.analyze",
  "video.create-variation",

  "audio.transcribe",
  "audio.generate-speech",
  "audio.analyze",
  "audio.generate-music",
] as const;

export type ActionId =
  (typeof ACTION_IDS)[number];

export const actionIdSchema =
  z.enum(ACTION_IDS);
```
### 6.1 actions Schema


```ts
export const actionSchema = z.object({
  key: z.string().cuid(),

  slug: actionIdSchema,

  name: z
    .string()
    .trim()
    .min(1)
    .max(100),

  description: z
    .string()
    .trim()
    .min(1)
    .max(4000),

  objective: z
    .string()
    .trim()
    .min(1)
    .max(4000),

  inputDescription: z
    .string()
    .trim()
    .min(1)
    .max(4000),

  outputDescription: z
    .string()
    .trim()
    .min(1)
    .max(4000),

  handlerKey: actionIdSchema,

  enabled: z.boolean().default(true),

  embedding: z
    .array(z.number().finite())
    .default([]),
}).superRefine((value, ctx) => {
  if (value.slug !== value.handlerKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["handlerKey"],
      message: "handlerKey must match slug",
    });
  }
});
```
Embed:
- `name`
- `description`
- `objective`
- `inputDescription`
- `outputDescription`

Create a unique index on `slug`.

## 7. Providers Registry


Providers describe external AI execution services.

All providers use the same conceptual interface.

Do not categorize providers.

Initial supported provider slugs:

```ts
export const PROVIDER_SLUGS = [
  "openai",
  "anthropic",
  "xai",
  "google-vertex",
  "azure-ai-foundry",
  "aws-bedrock",
  "openrouter",
] as const;
```

Only seed OpenAI in v1.
### 7.1 providers Schema


```ts
export const providerSlugSchema =
  z.enum(PROVIDER_SLUGS);

export const providerSchema = z.object({
  key: z.string().cuid(),

  slug: providerSlugSchema,

  name: z
    .string()
    .trim()
    .min(1)
    .max(100),

  description: z
    .string()
    .trim()
    .min(1)
    .max(4000),

  supportedUseCases: z
    .string()
    .trim()
    .min(1)
    .max(4000),

  handlerKey: providerSlugSchema,

  enabled: z.boolean().default(true),

  embedding: z
    .array(z.number().finite())
    .default([]),
}).superRefine((value, ctx) => {
  if (value.slug !== value.handlerKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["handlerKey"],
      message: "handlerKey must match slug",
    });
  }
});
```
Embed:
- `name`
- `description`
- `supportedUseCases`

Create a unique index on `slug`.

### 7.2 Provider TypeScript Registry


Provider nodes map to TypeScript adapters.

```ts
export interface ProviderAdapter {
  id: ProviderSlug;

  execute<TInput, TOutput>(
    request: ProviderExecuteRequest<TInput>,
  ): Promise<ProviderExecuteResponse<TOutput>>;
}
```

OpenAI should map through:

```text
providers.slug = openai
→ PROVIDER_REGISTRY.openai
→ openai.ts
```

Do not store credentials in provider nodes.
## 8. Models Registry


Models are logical AI models.

They do not directly store supported actions or provider routes.

Those relations live in:

- `modelActions`
- `modelProviders`

Initial models:

- `openai.gpt-5.4-nano`
- `openai.gpt-5.4-mini`
### 8.1 models Schema


```ts
export const modelSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/,
    "Model slug must use lowercase dot or hyphen notation",
  );

export const modelSchema = z.object({
  key: z.string().cuid(),

  slug: modelSlugSchema,

  name: z
    .string()
    .trim()
    .min(1)
    .max(150),

  description: z
    .string()
    .trim()
    .min(1)
    .max(4000),

  supportedUseCases: z
    .string()
    .trim()
    .min(1)
    .max(4000),

  enabled: z.boolean().default(true),

  embedding: z
    .array(z.number().finite())
    .default([]),
});
```
Embed:
- `name`
- `description`
- `supportedUseCases`

Create a unique index on `slug`.

### 8.2 modelActions


`modelActions` is the many-to-many relation between models and actions.

In v1:

```text
GPT-5.4 Nano
→ core.ask

GPT-5.4 Mini
→ core.reason
```

Database schema:

```ts
export const modelActionSchema = z.object({
  key: z.string().cuid(),

  modelKey: z.string().cuid(),

  actionKey: z.string().cuid(),

  priority: z
    .number()
    .int()
    .nonnegative()
    .default(100),

  enabled: z.boolean().default(true),
});
```

Seed schema:

```ts
export const modelActionSeedSchema = z.object({
  key: z.string().cuid(),

  modelSlug: modelSlugSchema,

  actionSlug: actionIdSchema,

  priority: z
    .number()
    .int()
    .nonnegative(),

  enabled: z.boolean(),
});
```
Create a unique index on:
- `modelKey + actionKey`

### 8.3 modelProviders


`modelProviders` maps models to executable provider routes.

Database schema:

```ts
export const modelProviderSchema = z.object({
  key: z.string().cuid(),

  modelKey: z.string().cuid(),

  providerKey: z.string().cuid(),

  providerModelId: z
    .string()
    .trim()
    .min(1)
    .max(500),

  enabled: z.boolean().default(true),
});
```

Seed schema:

```ts
export const modelProviderSeedSchema = z.object({
  key: z.string().cuid(),

  modelSlug: modelSlugSchema,

  providerSlug: providerSlugSchema,

  providerModelId: z
    .string()
    .trim()
    .min(1),

  enabled: z.boolean(),
});
```
Create a unique index on:
- `modelKey + providerKey`

### 8.4 organizationProviders


`organizationProviders` is the organization allow-list.

Document existence means the provider is enabled.

Do not add an `enabled` boolean.

```ts
export const organizationProviderSchema = z.object({
  key: z.string().cuid(),

  organizationKey: z.string().cuid(),

  providerKey: z.string().cuid(),
});
```
Create a unique index on:
- `organizationKey + providerKey`

## 9. Router


The router selects a valid model-provider route for an action.

Simple flow:

```text
Tool requests action
→ find Action
→ find enabled modelActions
→ sort priority descending
→ find enabled Model
→ find enabled modelProviders
→ keep providers enabled in organizationProviders
→ choose first valid route
→ execute through provider registry
```

For v1, do not add quality, speed, cost, or reliability scoring.

Use only `priority`.

Support three modes:

```text
auto
model
fixed
```
### 9.1 Router Request


```ts
export const autoRouteRequestSchema = z.object({
  mode: z.literal("auto"),
  organizationKey: z.string().cuid(),
  actionSlug: actionIdSchema,
});

export const modelRouteRequestSchema = z.object({
  mode: z.literal("model"),
  organizationKey: z.string().cuid(),
  actionSlug: actionIdSchema,
  modelSlug: modelSlugSchema,
});

export const fixedRouteRequestSchema = z.object({
  mode: z.literal("fixed"),
  organizationKey: z.string().cuid(),
  actionSlug: actionIdSchema,
  modelSlug: modelSlugSchema,
  providerSlug: providerSlugSchema,
});

export const routeRequestSchema =
  z.discriminatedUnion("mode", [
    autoRouteRequestSchema,
    modelRouteRequestSchema,
    fixedRouteRequestSchema,
  ]);
```
### 9.2 Router Rules

- Never use a provider not present in organizationProviders.
- Never use a disabled modelAction.
- Never use a disabled modelProvider.
- Never use a disabled model.
- Never use a disabled provider node.
- Never use a model that does not support the requested action.
- Model mode must stay on the selected model.
- Fixed mode must stay on the selected model and provider.
- Do not silently change fixed routes.
- Return typed errors when no route exists.
- Routing must be deterministic.

## 10. Tools Integration


Tools already exist.

Do not rebuild the Tool Registry.

Each tool should reference one or more actions through `toolActions`.

The important concept is:

```text
Tool
→ Action
→ Router
→ Model
→ Provider
```

Example:

```text
Ask Tool
→ core.ask
→ GPT-5.4 Nano
→ OpenAI
```

```text
Reason Tool
→ core.reason
→ GPT-5.4 Mini
→ OpenAI
```

If an agent does not have the Ask Tool, direct chat must not be available.
## 11. Skills Registry


A Skill represents a reusable professional role.

Examples:

- Backend Developer
- DevOps Engineer
- Account Executive
- Product Designer

A Skill is not a small function.

A Skill contains the complete role definition.
### 11.1 skills Schema


```ts
export const skillSchema = z.object({
  key: z.string().cuid(),

  slug: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Skill slug must use lowercase kebab-case",
    ),

  name: z
    .string()
    .trim()
    .min(1)
    .max(160),

  title: z
    .string()
    .trim()
    .min(1)
    .max(160),

  definition: z
    .string()
    .trim()
    .min(1),

  embedding: z
    .array(z.number().finite())
    .default([]),
});
```
Embed:
- `name`
- `title`
- `definition`

Create a unique index on `slug`.

### 11.2 Skill Definition Requirements


Each skill definition should contain sections equivalent to:

```text
Name
Title
Intent
Description
Responsibilities
In Scope
Out of Scope
Do
Don't
Success
Failure
Workflow
Tool Usage
Permission Rules
Output Instructions
```

The definition is injected into the agent runtime.
## 12. Agents Registry


An Agent is a named deployed AI worker.

Examples:

- Forge
- Mercury
- Atlas

An Agent belongs to one scope.

An Agent can have many skills.

An Agent can have many tools through the existing agentTools relation.
### 12.1 agents Schema


```ts
export const agentSchema = z.object({
  key: z.string().cuid(),

  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Agent slug must use lowercase kebab-case",
    ),

  name: z
    .string()
    .trim()
    .min(1)
    .max(120),

  title: z
    .string()
    .trim()
    .min(1)
    .max(160),

  scopeKey: z.string().cuid(),

  embedding: z
    .array(z.number().finite())
    .default([]),
});
```
Embed:
- `name`
- `title`

Create a unique index on `slug`.

### 12.2 agentSkills


`agentSkills` is the many-to-many relation between agents and skills.

```ts
export const agentSkillSchema = z.object({
  key: z.string().cuid(),

  agentKey: z.string().cuid(),

  skillKey: z.string().cuid(),

  priority: z
    .number()
    .int()
    .nonnegative()
    .default(100),
});
```

Higher priority means the skill is loaded earlier.

The highest-priority skill is the primary skill.
Create a unique index on:
- `agentKey + skillKey`

### 12.3 Agent Runtime Compilation


When executing an agent:

```text
1. Load agent.
2. Load agent scope.
3. Load agentSkills.
4. Sort agentSkills by priority descending.
5. Load all skill definitions.
6. Load agentTools.
7. Load Tool Registry entries.
8. Compile the runtime prompt.
9. Execute requested tools and actions.
10. Persist execution history.
```

Compiled runtime context should include:

```text
Agent identity
+
Scope context
+
Ordered Skill definitions
+
Available Tools
+
Tool permissions
+
Output schema
+
Current task
```
## 13. Guardrails


Each agent runtime receives a guardrails object.

For v1:

```json
{
  "scopeId": "cuid"
}
```

The value must come from the agent's `scopeKey`.

Do not permanently hardcode customer-specific scope IDs into static files.

The runtime injects the effective scope.
## 14. Agent Output Schema


Every agent output must contain metadata.

```ts
const maxTenWordsSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      value.split(/\s+/).length <= 10,
    "Reason must contain at most ten words",
  );

export const agentOutputMetadataSchema = z.object({
  status: z.enum([
    "accepted",
    "rejected",
  ]),

  reason: maxTenWordsSchema,

  score: z
    .number()
    .min(0)
    .max(1),
});
```

Rules:

- `status` is always present.
- `reason` is always present.
- `reason` contains at most ten words.
- `score` is always between 0 and 1.
- Rejected requests must not execute tools.
- Rejected requests must not answer out-of-scope tasks.
## 15. Agent Execution Storage


Do not place all execution details inside one large `agentRuns` document.

Use:

```text
agentRuns
agentRunSteps
agentRunCalls
agentArtifacts
agentMemories
```
### 15.1 agentRuns


`agentRuns` is the small summary of one execution.

```ts
export const agentRunSchema = z.object({
  key: z.string().cuid(),

  organizationKey: z.string().cuid(),

  scopeKey: z.string().cuid(),

  agentKey: z.string().cuid(),

  status: z.enum([
    "accepted",
    "rejected",
    "completed",
    "failed",
    "cancelled",
    "timeout",
  ]),

  reason: maxTenWordsSchema,

  score: z
    .number()
    .min(0)
    .max(1),

  startedAt: z.string().datetime(),

  endedAt: z.string().datetime(),

  elapsedMs: z
    .number()
    .int()
    .nonnegative(),

  createdAt: z.string().datetime(),
});
```
Do not store:
- steps arrays
- calls arrays
- token totals
- artifacts arrays
- memory arrays

Those belong in separate collections.

### 15.2 agentRunSteps


One document per actual execution step.

```ts
export const AGENT_RUN_STEP_STATUSES = [
  "completed",
  "failed",
  "skipped",
] as const;

export const agentRunStepSchema = z.object({
  key: z.string().cuid(),

  agentRunKey: z.string().cuid(),

  stepSlug: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Step slug must use lowercase kebab-case",
    ),

  status: z.enum(
    AGENT_RUN_STEP_STATUSES,
  ),

  startedAt: z.string().datetime(),

  endedAt: z.string().datetime(),

  elapsedMs: z
    .number()
    .int()
    .nonnegative(),
});
```

`key` identifies this specific step occurrence.

`stepSlug` identifies the logical step.

Examples:

```text
inspect-backend
reason-about-architecture
prepare-recommendation
validate-output
```
Create indexes on:
- `agentRunKey`
- `agentRunKey + stepSlug`

### 15.3 agentRunCalls


One document per actual model call.

This is the authoritative token-usage record.

```ts
export const agentRunCallSchema = z.object({
  key: z.string().cuid(),

  agentRunKey: z.string().cuid(),

  agentRunStepKey: z
    .string()
    .cuid()
    .nullable(),

  skillKey: z.string().cuid(),

  toolKey: z
    .string()
    .cuid()
    .nullable(),

  actionKey: z.string().cuid(),

  modelKey: z.string().cuid(),

  providerKey: z.string().cuid(),

  inputTokens: z
    .number()
    .int()
    .nonnegative(),

  outputTokens: z
    .number()
    .int()
    .nonnegative(),

  totalTokens: z
    .number()
    .int()
    .nonnegative(),

  startedAt: z.string().datetime(),

  endedAt: z.string().datetime(),

  elapsedMs: z
    .number()
    .int()
    .nonnegative(),
}).superRefine((value, ctx) => {
  if (
    value.totalTokens !==
    value.inputTokens +
      value.outputTokens
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["totalTokens"],
      message:
        "totalTokens must equal inputTokens plus outputTokens",
    });
  }
});
```
This collection supports token aggregation per:
- agent
- skill
- tool
- action
- model
- provider
- scope
- organization
- run
- step

Runtime must obtain token usage from the provider response.
The agent must never invent token counts.

### 15.4 agentArtifacts


`agentArtifacts` links persisted outputs to a run.

```ts
export const AGENT_ARTIFACT_RELATIONS = [
  "result",
  "attachment",
  "source",
  "intermediate",
] as const;

export const agentArtifactSchema = z.object({
  key: z.string().cuid(),

  agentRunKey: z.string().cuid(),

  artifactKey: z.string().cuid(),

  relation: z.enum(
    AGENT_ARTIFACT_RELATIONS,
  ),
});
```

Meanings:

```text
result
= final output

attachment
= attached supporting artifact

source
= source artifact used by the run

intermediate
= artifact created during execution
```
Create indexes on:
- `agentRunKey`
- `artifactKey`
- `agentRunKey + artifactKey + relation` unique

### 15.5 agentMemories


`agentMemories` stores reusable knowledge that should survive the run.

A run is history.

A memory is reusable future context.

Do not automatically turn every run into memory.

```ts
export const AGENT_MEMORY_TYPES = [
  "fact",
  "preference",
  "decision",
  "instruction",
  "observation",
  "outcome",
] as const;

export const agentMemorySchema = z.object({
  key: z.string().cuid(),

  organizationKey: z.string().cuid(),

  scopeKey: z.string().cuid(),

  agentKey: z.string().cuid(),

  skillKey: z
    .string()
    .cuid()
    .nullable(),

  sourceRunKey: z
    .string()
    .cuid()
    .nullable(),

  content: z
    .string()
    .trim()
    .min(1)
    .max(10000),

  memoryType: z.enum(
    AGENT_MEMORY_TYPES,
  ),

  importance: z
    .number()
    .min(0)
    .max(1),

  embedding: z
    .array(z.number().finite())
    .default([]),

  createdAt: z.string().datetime(),
});
```
Embed only:
- `content`

Good memories:
- User prefers concise sales emails.
- Backend uses ArangoDB and Zod.
- Customer rejected annual billing.

Do not store as memory:
- model latency
- token counts
- step completion events
- transient tool errors

## 16. V1 Seed Data


The implementation must include seed files for:

- 16 actions
- OpenAI provider only
- GPT-5.4 Nano
- GPT-5.4 Mini
- modelActions
- modelProviders

Use real CUID values.

Seed order:

```text
1. actions
2. providers
3. models
4. modelActions
5. modelProviders
```
### 16.1 Providers Seed


```json
{
  "collection": "providers",
  "upsertBy": "slug",
  "embeddingFields": [
    "name",
    "description",
    "supportedUseCases"
  ],
  "providers": [
    {
      "key": "cmzx8v2f10001k9q3n6p4r7st",
      "slug": "openai",
      "name": "OpenAI",
      "description": "Provides language, reasoning, image, audio, and multimodal artificial intelligence models through OpenAI APIs.",
      "supportedUseCases": "Conversational responses, reasoning, structured outputs, agent execution, image generation, audio processing, and multimodal workflows.",
      "handlerKey": "openai",
      "enabled": true,
      "embedding": []
    }
  ]
}
```
### 16.2 Models Seed


```json
{
  "collection": "models",
  "upsertBy": "slug",
  "embeddingFields": [
    "name",
    "description",
    "supportedUseCases"
  ],
  "models": [
    {
      "key": "cmzx8v2f10002k9q3n6p4r7su",
      "slug": "openai.gpt-5.4-nano",
      "name": "GPT-5.4 Nano",
      "description": "A fast and efficient language model intended for lightweight conversational responses, classification, metadata generation, and structured agent operations.",
      "supportedUseCases": "Direct agent questions, short conversational responses, classification, validation, scope decisions, metadata generation, and low-cost structured outputs.",
      "enabled": true,
      "embedding": []
    },
    {
      "key": "cmzx8v2f10003k9q3n6p4r7sv",
      "slug": "openai.gpt-5.4-mini",
      "name": "GPT-5.4 Mini",
      "description": "A balanced reasoning model intended for analysis, planning, problem solving, structured outputs, and more demanding agent execution.",
      "supportedUseCases": "Reasoning, planning, analysis, decision support, coding tasks, research synthesis, structured outputs, and complex agent workflows.",
      "enabled": true,
      "embedding": []
    }
  ]
}
```
### 16.3 modelActions Seed


```json
{
  "collection": "modelActions",
  "upsertBy": [
    "modelSlug",
    "actionSlug"
  ],
  "modelActions": [
    {
      "key": "cmzx8v2f10004k9q3n6p4r7sw",
      "modelSlug": "openai.gpt-5.4-nano",
      "actionSlug": "core.ask",
      "priority": 100,
      "enabled": true
    },
    {
      "key": "cmzx8v2f10005k9q3n6p4r7sx",
      "modelSlug": "openai.gpt-5.4-mini",
      "actionSlug": "core.reason",
      "priority": 100,
      "enabled": true
    }
  ]
}
```
### 16.4 modelProviders Seed


```json
{
  "collection": "modelProviders",
  "upsertBy": [
    "modelSlug",
    "providerSlug"
  ],
  "modelProviders": [
    {
      "key": "cmzx8v2f10006k9q3n6p4r7sy",
      "modelSlug": "openai.gpt-5.4-nano",
      "providerSlug": "openai",
      "providerModelId": "gpt-5.4-nano",
      "enabled": true
    },
    {
      "key": "cmzx8v2f10007k9q3n6p4r7sz",
      "modelSlug": "openai.gpt-5.4-mini",
      "providerSlug": "openai",
      "providerModelId": "gpt-5.4-mini",
      "enabled": true
    }
  ]
}
```
## 17. Repository Requirements

- Use parameterized AQL.
- Parse database documents with Zod.
- Never return raw ArangoDB metadata outside repositories.
- Map `_key` to domain `key` internally if necessary.
- Expose `findByKey` and `findBySlug` for registries.
- Expose list methods for linking nodes.
- Throw typed errors for missing references.
- Do not silently ignore invalid seed references.
- Make all seed upserts idempotent.
- Create indexes idempotently.

## 18. Service Requirements

- Validate all inputs with Zod.
- Enforce organization boundaries.
- Reject cross-organization scope links.
- Reject duplicate linking nodes.
- Reject scope cycles.
- Resolve seed slugs to keys before persistence.
- Compile skills by priority.
- Resolve tools through existing agentTools.
- Resolve models through modelActions.
- Resolve providers through modelProviders and organizationProviders.
- Write one agentRunCall for every real model invocation.
- Create memories only through explicit memory selection logic.

## 19. Testing Requirements

- Scope slug uniqueness per organization.
- Scope parent and child belong to same organization.
- Scope cycle rejection.
- Scope sibling position uniqueness.
- Scope member role validation.
- Scope member joins to userOrganizations and users.
- Action registry completeness.
- Provider slug to handler mapping.
- Model slug uniqueness.
- modelActions relation uniqueness.
- modelProviders relation uniqueness.
- organizationProviders allow-list enforcement.
- Ask routes only to GPT-5.4 Nano in v1.
- Reason routes only to GPT-5.4 Mini in v1.
- Fixed route cannot bypass organization provider permissions.
- Agent slug uniqueness.
- Agent must reference an existing scope.
- agentSkills priority ordering.
- Duplicate agentSkills rejection.
- Rejected output blocks tool execution.
- Reason word limit is enforced.
- Score range is enforced.
- agentRunStep uses a stable stepSlug.
- agentRunCall token totals are validated.
- Artifacts link correctly to runs.
- Only selected knowledge becomes memory.
- All seeds are idempotent.

## 20. Public Exports


Each module must export only its intended public API.

Examples:

```ts
export {
  scopeSchema,
  type Scope,
  scopeRepository,
  scopeService,
} from "./scopes";

export {
  skillSchema,
  type Skill,
  skillRepository,
  skillService,
} from "./skills";

export {
  agentSchema,
  type Agent,
  agentRepository,
  agentService,
} from "./agents";

export {
  selectRoute,
  executeRoute,
  routeRequestSchema,
  type RouteRequest,
} from "./router";
```

Avoid wildcard exports from deeply internal implementation files.
## 21. Dependency Direction


Keep dependencies acyclic.

Preferred direction:

```text
shared
↑
identity
↑
scopes
↑
actions
↑
providers
↑
models
↑
router
↑
skills
↑
agents
↑
agent runtime
```

Provider modules must not import the router.

Action modules must not import models.

Models must not import agents.

Agent runtime may depend on all lower layers.
## 22. Implementation Order

1. Create shared CUID and embedding helpers.
2. Implement scopes.
3. Implement scopeScopes.
4. Implement scopeMembers.
5. Implement actions registry and seed.
6. Implement providers registry and OpenAI adapter.
7. Implement models registry and seed.
8. Implement modelActions.
9. Implement modelProviders.
10. Implement organizationProviders.
11. Implement router.
12. Connect existing Tools to actions.
13. Implement skills.
14. Implement agents.
15. Implement agentSkills.
16. Implement guardrail injection.
17. Implement agent output schema metadata.
18. Implement agentRuns.
19. Implement agentRunSteps.
20. Implement agentRunCalls.
21. Implement agentArtifacts.
22. Implement agentMemories.
23. Add indexes.
24. Add unit tests.
25. Add integration tests.
26. Run typecheck, lint, and tests.

## 23. Explicit Non-Goals

- Do not add a capability registry.
- Do not categorize providers.
- Do not add dynamic quality scoring in v1.
- Do not store credentials in ArangoDB.
- Do not duplicate model actions inside model nodes.
- Do not duplicate model providers inside model nodes.
- Do not store all execution details inside agentRuns.
- Do not automatically create memory from every run.
- Do not expose chat when the agent lacks Ask Tool.
- Do not use random routing.
- Do not create a separate Steps registry.
- Do not store embedding metadata inside nodes.
- Do not use `_key` in domain schemas.
- Do not use snake_case collection names.

## 24. Required Final Report


When implementation is complete, report:

1. Final folder tree.
2. Every created file.
3. Every modified file.
4. Final collection names.
5. Final Zod schemas.
6. Final indexes.
7. Final seed files.
8. Final public exports.
9. Router algorithm.
10. Agent runtime compilation flow.
11. Execution persistence flow.
12. Test files and test results.
13. Typecheck result.
14. Lint result.
15. Any assumptions.
16. Any deviations from this specification.
17. Any intentionally deferred work.

Do not claim completion unless typecheck, lint, and tests pass.
## 25. Reference Flow Examples

### Ask execution

1. User opens an agent.
2. Runtime checks whether the agent has Ask Tool.
3. Ask Tool maps to `core.ask`.
4. Router resolves `core.ask` through modelActions.
5. GPT-5.4 Nano is selected.
6. modelProviders resolves OpenAI.
7. organizationProviders confirms OpenAI is allowed.
8. OpenAI adapter executes.
9. agentRun is created.
10. agentRunStep is created.
11. agentRunCall records tokens.
12. Final result is validated.

### Reason execution

1. Agent invokes Reason Tool.
2. Reason Tool maps to `core.reason`.
3. Router resolves GPT-5.4 Mini.
4. OpenAI provider route is validated.
5. Model call is executed.
6. Token usage is written to agentRunCalls.
7. Output metadata is validated.
8. Result artifact may be linked.

### Memory creation

1. Run completes.
2. Runtime evaluates reusable information.
3. Only durable information is selected.
4. Memory content is normalized.
5. Memory type and importance are assigned.
6. Embedding is generated.
7. agentMemory is persisted.
8. Technical call data remains in agentRunCalls.