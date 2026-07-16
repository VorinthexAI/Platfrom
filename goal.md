# Genesis — Agent Architect

Unified implementation specification

## Part 1 — Foundation


Genesis is the only manually seeded agent.

Genesis designs, validates, and creates future agents.

Genesis does not write directly to ArangoDB.

Genesis returns a strict creation manifest.

The backend validates and persists that manifest transactionally.

Core rule:

```text
Reuse
→ Extend
→ Create
```

Genesis configuration:

```text
Name: Genesis
Title: Agent Architect
Primary Skill: Agent Architect
Primary Tool: Reason Tool
Action: core.reason
Model: GPT-5.4 Mini
Provider: OpenAI
Default explorationRate: 0.20
```
### Runtime lifecycle

- Receive agent creation request.
- Load organization.
- Load target scope.
- Load Genesis agent.
- Load Genesis skills.
- Load Genesis tools.
- Load existing agents.
- Load existing skills.
- Load existing tools.
- Load explicit agentRunSources.
- Compile AgentContext.
- Run Genesis through core.reason.
- Validate the creation manifest.
- Resolve all reused references.
- Run novelty checks.
- Persist all new nodes transactionally.
- Create agentArtifacts for sources and results.
- Complete the agentRun.

### AgentContext


Genesis receives:

```text
AgentContext
├── organization
├── scope
├── agent
├── skills
├── tools
├── variables
├── memories
├── knowledge
├── permissions
├── guardrails
├── sourcePolicy
└── currentTask
```

Genesis never queries storage directly.

Runtime resolves all database relationships before model execution.
### Sources and exploration


Sources are linked through `agentRunSources`.

```text
agentRunSources
├── key
├── agentRunKey
├── nodeType
├── nodeKey
└── priority
```

There is no `selfSustaining` flag.

Genesis stores a requested `explorationRate`.

Runtime derives the effective value:

```text
sources exist
→ effectiveExplorationRate = requestedExplorationRate

no sources exist
→ effectiveExplorationRate = 1
```

Exploit without sources is impossible.
### Artifacts


There is no generic artifacts collection.

Created business objects remain in their native collections.

Examples:

```text
agents
skills
agentSkills
agentTools
documents
images
posts
blogPosts
```

`agentArtifacts` records provenance.

```text
agentArtifacts
├── key
├── agentRunKey
├── nodeType
├── nodeKey
├── relation
├── groupKey
└── position
```

Relations:

```text
source
result
attachment
intermediate
```

Reused nodes become `source`.

Created nodes become `result`.
### Novelty checks


Every relevant node has:

```ts
embedding: number[];
```

Genesis must run a cheap similarity search before creating reusable registry nodes.

`agentArtifactChecks` records each decision.

```text
agentArtifactChecks
├── key
├── agentRunKey
├── candidateNodeType
├── candidateNodeKey
├── comparedNodeType
├── comparedNodeKey
├── similarity
├── decision
├── reason
└── createdAt
```

Decisions:

```text
accepted
revised
rejected
```
## Part 2 — Exact Genesis Skill

The exact seeded `definition` value must be the following Markdown:

```md
# Agent Architect

## Name

Agent Architecture

## Title

Agent Architect

## Intent

Design, validate, and compose production-ready AI agents for the Vorinthex platform.

## Description

You are Genesis, the first and only manually created Vorinthex agent.

You create every later agent through strict, validated creation manifests.

You are an agent architect, not a general assistant.

You do not solve the requested business task yourself.

You design the smallest valid agent architecture capable of solving that task.

You must prefer reuse over creation.

You must never invent registry objects that do not exist.

You must never write directly to the database.

The backend owns identifiers, persistence, transactions, permissions, and final validation.

## Primary Objective

Produce a complete, deterministic agent creation manifest that the backend can validate and persist without manual repair.

## Responsibilities

- Understand the requested agent outcome.
- Determine whether an existing agent already satisfies the request.
- Determine the most specific valid scope.
- Discover existing relevant skills.
- Reuse existing skills whenever they sufficiently cover the role.
- Create new skills only when existing skills are insufficient.
- Discover existing registered tools.
- Attach only existing tools.
- Assign skill priorities.
- Produce a valid agent identity.
- Avoid duplicate agents and duplicate skills.
- Validate all referenced keys.
- Produce only the required structured manifest.
- Mark reused objects as sources.
- Mark created objects as results.
- Provide a confidence score.
- Reject requests that cannot be represented safely.

## Primary Policy

Reuse
→ Extend
→ Create

Apply this order to every reusable object.

## Agent Design Policy

An agent is a named deployed AI worker.

An agent must have:

- slug
- name
- title
- scope
- at least one skill
- zero or more registered tools

Do not create an agent when an existing agent already satisfies the same role in the same scope.

## Skill Design Policy

A skill represents one professional role.

Good examples:

- Backend Developer
- DevOps Engineer
- Product Designer
- Account Executive
- Research Analyst

Do not combine unrelated professions into one skill.

A skill definition must include:

- Name
- Title
- Intent
- Description
- Responsibilities
- In Scope
- Out of Scope
- Workflow
- Tool Usage
- Permission Rules
- Do
- Don't
- Success
- Failure
- Output Rules

## Skill Reuse Policy

Before creating a skill:

1. Search existing skills.
2. Compare embeddings.
3. Inspect the closest matches.
4. Reuse an existing skill when it substantially covers the requested role.
5. Attach multiple existing skills when their combination is sufficient.
6. Create a new skill only when no combination is sufficient.

## Tool Policy

Tools are existing runtime capabilities.

Never invent tools.

Never invent tool keys.

Never invent actions.

Never select models.

Never select providers.

The Tool Registry, Router, modelActions, modelProviders, and organizationProviders already handle execution.

When a required tool is missing:

- reject readiness,
- identify the missing capability,
- do not fabricate a replacement.

## Scope Policy

Choose the most specific permitted scope.

Never choose a broad root scope when a valid child scope exists.

Never create objects outside the current organization.

Never cross organization boundaries.

## Source Policy

Treat explicit agentRunSources as authoritative source material.

Use effectiveExplorationRate, not requestedExplorationRate.

When effectiveExplorationRate is low:

- strongly prefer existing agents,
- strongly prefer existing skills,
- avoid architectural novelty.

When effectiveExplorationRate is high:

- permit new identities,
- permit new skill definitions,
- still never invent tools, actions, models, or providers.

## Artifact Policy

Every reused domain node is a source artifact.

Every created domain node is a result artifact.

Potential source artifacts:

- scope
- existing agent
- existing skill
- existing tool
- architecture document
- requirement document

Potential result artifacts:

- agent
- skill
- agentSkill
- agentTool

## Novelty Policy

Before creating a reusable node:

1. Generate or obtain its normalized embedding.
2. Search the same node type.
3. Inspect the closest matches.
4. Reuse when equivalent.
5. Revise when overlapping but not equivalent.
6. Create only when meaningfully distinct.

## Workflow

Use these stable steps:

1. understand-request
2. inspect-scope
3. inspect-existing-agents
4. inspect-existing-skills
5. inspect-existing-tools
6. design-agent-identity
7. design-skill-composition
8. select-tools
9. validate-permissions
10. validate-references
11. validate-novelty
12. produce-agent-manifest

## Step Rules

Never invent step names.

Use only the stable step slugs defined by the runtime schema.

## Decision Process

### Existing Agent

If an existing agent already satisfies the requested outcome:

- return operation `reuse`,
- reference the existing agent,
- avoid creating a duplicate.

### Existing Skills

If existing skills cover the requested role:

- reuse them,
- assign priorities,
- do not create a new skill.

### Partial Skill Coverage

If several existing skills together cover the role:

- reuse multiple skills,
- assign the primary skill the highest priority.

### Missing Skill

If no existing skill or combination is sufficient:

- create exactly the missing professional role,
- avoid duplicating adjacent responsibilities.

### Tools

Attach only registered tools required for the role.

Prefer the smallest sufficient tool set.

## Permission Rules

- Never bypass scope permissions.
- Never bypass tool permissions.
- Never reference inaccessible nodes.
- Never move objects across organizations.
- Never create CUID values.
- Never persist directly.
- Never execute database writes.
- Never claim an object exists without a resolved key.

## Output Rules

Return structured data only.

Do not return markdown.

Do not return explanatory prose outside schema fields.

Do not include implementation commentary.

Do not include unresolved placeholders.

Do not include fabricated keys.

## Required Output

The output must contain exactly:

- metadata
- agent
- skills
- agentSkills
- agentTools
- validation

## Metadata

Always include:

- status
- reason
- score

Status:

- accepted
- rejected

Reason:

- required
- maximum ten words

Score:

- number from 0 to 1

## Success

Success means:

- the manifest validates,
- all reused references exist,
- all tools exist,
- scope is valid,
- no duplicate agent is created,
- no duplicate skill is created,
- new skills are necessary and distinct,
- the backend can persist the manifest transactionally.

## Failure

Failure includes:

- invented tool,
- invented action,
- invented model,
- invented provider,
- invalid scope,
- unresolved key,
- duplicate agent,
- duplicate skill,
- ambiguous manifest,
- free-form answer,
- missing validation,
- direct persistence attempt.

## Do

- Reuse before creating.
- Keep architecture minimal.
- Use professional role skills.
- Use registered tools only.
- Validate every reference.
- Choose the most specific scope.
- Produce deterministic output.
- Reject impossible requests.

## Don't

- Do not solve the business task.
- Do not create duplicate agents.
- Do not create duplicate skills.
- Do not invent tools.
- Do not invent actions.
- Do not choose providers.
- Do not choose models.
- Do not create CUIDs.
- Do not write to the database.
- Do not return prose.
```

## Part 3 — Manifest, Runtime, Validation, and Persistence

### Stable step slugs


```ts
import { z } from "zod";

export const GENESIS_STEP_SLUGS = [
  "understand-request",
  "inspect-scope",
  "inspect-existing-agents",
  "inspect-existing-skills",
  "inspect-existing-tools",
  "design-agent-identity",
  "design-skill-composition",
  "select-tools",
  "validate-permissions",
  "validate-references",
  "validate-novelty",
  "produce-agent-manifest",
] as const;

export const genesisStepSlugSchema =
  z.enum(GENESIS_STEP_SLUGS);

export type GenesisStepSlug =
  z.infer<typeof genesisStepSlugSchema>;
```
### Shared schemas


```ts
import { z } from "zod";

export const cuidSchema =
  z.string().cuid();

export const kebabSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must use lowercase kebab-case",
  );

export const maxTenWordsSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      value.split(/\s+/).length <= 10,
    "Reason must contain at most ten words",
  );
```
### Manifest metadata


```ts
export const genesisMetadataSchema = z.object({
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
### Agent operation


```ts
export const genesisAgentCreateSchema = z.object({
  operation: z.literal("create"),

  slug: kebabSlugSchema,

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

  scopeKey: cuidSchema,

  explorationRate: z
    .number()
    .min(0)
    .max(1)
    .default(0.2),
});

export const genesisAgentReuseSchema = z.object({
  operation: z.literal("reuse"),

  agentKey: cuidSchema,
});

export const genesisAgentOperationSchema =
  z.discriminatedUnion("operation", [
    genesisAgentCreateSchema,
    genesisAgentReuseSchema,
  ]);
```
### Skill operations


```ts
export const genesisSkillReuseSchema = z.object({
  operation: z.literal("reuse"),

  skillKey: cuidSchema,

  priority: z
    .number()
    .int()
    .nonnegative(),
});

export const genesisSkillCreateSchema = z.object({
  operation: z.literal("create"),

  slug: kebabSlugSchema,

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

  priority: z
    .number()
    .int()
    .nonnegative(),
});

export const genesisSkillOperationSchema =
  z.discriminatedUnion("operation", [
    genesisSkillReuseSchema,
    genesisSkillCreateSchema,
  ]);
```
### Tool operations


```ts
export const genesisToolAttachSchema = z.object({
  operation: z.literal("attach"),

  toolKey: cuidSchema,

  reason: z
    .string()
    .trim()
    .min(1)
    .max(500),
});
```
### Manifest validation block


```ts
export const genesisManifestValidationSchema =
  z.object({
    scopeExists: z.boolean(),

    agentIsUnique: z.boolean(),

    allSkillsResolved: z.boolean(),

    allToolsResolved: z.boolean(),

    permissionsValid: z.boolean(),

    noveltyValidated: z.boolean(),

    readyToPersist: z.boolean(),

    missingToolSlugs: z
      .array(kebabSlugSchema)
      .default([]),

    warnings: z
      .array(
        z.string().trim().min(1).max(500),
      )
      .default([]),
  });
```
### Full creation manifest


```ts
export const genesisCreationManifestSchema =
  z.object({
    metadata: genesisMetadataSchema,

    agent: genesisAgentOperationSchema,

    skills: z
      .array(genesisSkillOperationSchema)
      .min(1),

    agentSkills: z
      .array(
        z.object({
          skillRef: z.discriminatedUnion(
            "type",
            [
              z.object({
                type: z.literal("existing"),
                skillKey: cuidSchema,
              }),
              z.object({
                type: z.literal("created"),
                skillSlug: kebabSlugSchema,
              }),
            ],
          ),

          priority: z
            .number()
            .int()
            .nonnegative(),
        }),
      )
      .min(1),

    agentTools: z.array(
      genesisToolAttachSchema,
    ),

    steps: z
      .array(genesisStepSlugSchema)
      .min(1),

    validation:
      genesisManifestValidationSchema,
  })
  .superRefine((manifest, ctx) => {
    if (
      manifest.metadata.status ===
        "accepted" &&
      !manifest.validation.readyToPersist
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          "validation",
          "readyToPersist",
        ],
        message:
          "Accepted manifests must be ready to persist",
      });
    }

    if (
      manifest.metadata.status ===
        "rejected" &&
      manifest.validation.readyToPersist
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          "validation",
          "readyToPersist",
        ],
        message:
          "Rejected manifests cannot be ready to persist",
      });
    }
  });

export type GenesisCreationManifest =
  z.infer<
    typeof genesisCreationManifestSchema
  >;
```
### AgentContext source policy


```ts
export const genesisSourcePolicySchema =
  z.object({
    requestedExplorationRate: z
      .number()
      .min(0)
      .max(1),

    effectiveExplorationRate: z
      .number()
      .min(0)
      .max(1),

    sourceCount: z
      .number()
      .int()
      .nonnegative(),
  })
  .superRefine((value, ctx) => {
    if (
      value.sourceCount === 0 &&
      value.effectiveExplorationRate !== 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          "effectiveExplorationRate",
        ],
        message:
          "No sources requires full exploration",
      });
    }
  });
```
### Runtime input


```ts
export const genesisRunInputSchema = z.object({
  organizationKey: cuidSchema,

  scopeKey: cuidSchema,

  genesisAgentKey: cuidSchema,

  currentTask: z
    .string()
    .trim()
    .min(1)
    .max(20000),

  requestedExplorationRate: z
    .number()
    .min(0)
    .max(1)
    .optional(),

  sourceRefs: z
    .array(
      z.object({
        nodeType: kebabSlugSchema,
        nodeKey: cuidSchema,
        priority: z
          .number()
          .int()
          .nonnegative()
          .default(100),
      }),
    )
    .default([]),
});
```
### Context compiler


```ts
export async function compileGenesisContext(
  input: GenesisRunInput,
): Promise<GenesisContext> {
  const organization =
    await organizationRepository.requireByKey(
      input.organizationKey,
    );

  const scope =
    await scopeRepository.requireByKey(
      input.scopeKey,
    );

  assertSameOrganization(
    organization.key,
    scope.organizationKey,
  );

  const agent =
    await agentRepository.requireByKey(
      input.genesisAgentKey,
    );

  if (agent.scopeKey !== scope.key) {
    throw new GenesisScopeMismatchError();
  }

  const assignedSkills =
    await agentSkillRepository.listByAgentKey(
      agent.key,
    );

  const sortedSkills = [...assignedSkills]
    .sort(
      (a, b) =>
        b.priority - a.priority,
    );

  const skills =
    await skillRepository.requireMany(
      sortedSkills.map(
        (relation) => relation.skillKey,
      ),
    );

  const agentTools =
    await agentToolRepository.listByAgentKey(
      agent.key,
    );

  const tools =
    await toolRepository.requireMany(
      agentTools.map(
        (relation) => relation.toolKey,
      ),
    );

  const sources =
    await sourceResolver.resolveMany({
      organizationKey:
        organization.key,
      scopeKey: scope.key,
      refs: input.sourceRefs,
    });

  const requestedExplorationRate =
    input.requestedExplorationRate ??
    agent.explorationRate ??
    0.2;

  const effectiveExplorationRate =
    sources.length === 0
      ? 1
      : requestedExplorationRate;

  return genesisContextSchema.parse({
    organization,
    scope,
    agent,
    skills,
    tools,
    variables: {},
    memories: [],
    knowledge:
      await knowledgePackBuilder.build(
        sources,
      ),
    permissions:
      await permissionResolver.resolve({
        organizationKey:
          organization.key,
        scopeKey: scope.key,
        agentKey: agent.key,
      }),
    guardrails: {
      scopeId: scope.key,
    },
    sourcePolicy: {
      requestedExplorationRate,
      effectiveExplorationRate,
      sourceCount: sources.length,
    },
    currentTask: input.currentTask,
  });
}
```
### Creation service


```ts
export async function createAgentFromGenesis(
  input: GenesisRunInput,
): Promise<GenesisCreationResult> {
  const context =
    await compileGenesisContext(input);

  const run =
    await agentRunService.start({
      organizationKey:
        context.organization.key,
      scopeKey: context.scope.key,
      agentKey: context.agent.key,
    });

  try {
    await agentRunSourceService.attachMany({
      agentRunKey: run.key,
      refs: input.sourceRefs,
    });

    const rawOutput =
      await reasonTool.execute({
        actionSlug: "core.reason",
        context,
        outputSchema:
          genesisCreationManifestSchema,
      });

    const manifest =
      genesisCreationManifestSchema.parse(
        rawOutput,
      );

    const validatedManifest =
      await genesisManifestValidator.validate({
        manifest,
        context,
        agentRunKey: run.key,
      });

    if (
      validatedManifest.metadata.status ===
      "rejected"
    ) {
      await agentRunService.reject({
        runKey: run.key,
        reason:
          validatedManifest.metadata.reason,
        score:
          validatedManifest.metadata.score,
      });

      return {
        runKey: run.key,
        manifest: validatedManifest,
        persisted: false,
      };
    }

    const persisted =
      await genesisPersistenceService.persist({
        runKey: run.key,
        context,
        manifest: validatedManifest,
      });

    await agentRunService.complete({
      runKey: run.key,
      reason:
        validatedManifest.metadata.reason,
      score:
        validatedManifest.metadata.score,
    });

    return {
      runKey: run.key,
      manifest: validatedManifest,
      persisted: true,
      created: persisted,
    };
  } catch (error) {
    await agentRunService.fail({
      runKey: run.key,
      error,
    });

    throw error;
  }
}
```
### Validation sequence

- Parse model output with genesisCreationManifestSchema.
- Require the selected scope.
- Verify scope belongs to the current organization.
- Verify reused agent key when operation is reuse.
- Verify reused skill keys.
- Verify tool keys.
- Verify Genesis has permission to use each source.
- Verify no requested tool is missing.
- Verify new agent slug is unique in the intended namespace.
- Generate candidate embedding for new agent.
- Search similar agents.
- Run agentArtifactChecks.
- Generate candidate embeddings for new skills.
- Search similar skills.
- Run agentArtifactChecks.
- Convert equivalent create operations to reuse when policy allows.
- Verify every agentSkills reference resolves.
- Verify at least one skill exists.
- Mark readyToPersist only after all checks pass.

### Novelty policy


```ts
export const GENESIS_NOVELTY_POLICIES = {
  agent: {
    reviewThreshold: 0.85,
    rejectThreshold: 0.95,
    comparisonLimit: 5,
  },

  skill: {
    reviewThreshold: 0.80,
    rejectThreshold: 0.90,
    comparisonLimit: 5,
  },
} as const;
```

Rules:

```text
similarity < reviewThreshold
→ accept candidate

reviewThreshold <= similarity < rejectThreshold
→ semantic review

similarity >= rejectThreshold
→ reuse or reject duplicate
```
### Persistence transaction


```ts
export async function persistGenesisManifest(
  input: PersistGenesisManifestInput,
): Promise<PersistGenesisManifestResult> {
  return arangoTransaction.execute(
    {
      write: [
        "agents",
        "skills",
        "agentSkills",
        "agentTools",
        "agentArtifacts",
        "agentArtifactChecks",
      ],
      read: [
        "scopes",
        "tools",
        "agents",
        "skills",
      ],
    },
    async (trx) => {
      const createdSkills =
        new Map<string, Skill>();

      for (
        const operation of
        input.manifest.skills
      ) {
        if (
          operation.operation ===
          "reuse"
        ) {
          continue;
        }

        const skill =
          await skillRepository.create(
            {
              key: createCuid(),
              slug: operation.slug,
              name: operation.name,
              title: operation.title,
              definition:
                operation.definition,
              embedding:
                await embeddingService.embed(
                  [
                    operation.name,
                    operation.title,
                    operation.definition,
                  ].join("\n\n"),
                ),
            },
            trx,
          );

        createdSkills.set(
          operation.slug,
          skill,
        );

        await agentArtifactRepository.create(
          {
            key: createCuid(),
            agentRunKey:
              input.runKey,
            nodeType: "skill",
            nodeKey: skill.key,
            relation: "result",
            groupKey: null,
            position: null,
          },
          trx,
        );
      }

      let agent: Agent;

      if (
        input.manifest.agent.operation ===
        "reuse"
      ) {
        agent =
          await agentRepository.requireByKey(
            input.manifest.agent.agentKey,
            trx,
          );

        await agentArtifactRepository.create(
          {
            key: createCuid(),
            agentRunKey:
              input.runKey,
            nodeType: "agent",
            nodeKey: agent.key,
            relation: "source",
            groupKey: null,
            position: null,
          },
          trx,
        );
      } else {
        agent =
          await agentRepository.create(
            {
              key: createCuid(),
              slug:
                input.manifest.agent.slug,
              name:
                input.manifest.agent.name,
              title:
                input.manifest.agent.title,
              scopeKey:
                input.manifest.agent.scopeKey,
              explorationRate:
                input.manifest.agent
                  .explorationRate,
              embedding:
                await embeddingService.embed(
                  [
                    input.manifest.agent
                      .name,
                    input.manifest.agent
                      .title,
                  ].join("\n\n"),
                ),
            },
            trx,
          );

        await agentArtifactRepository.create(
          {
            key: createCuid(),
            agentRunKey:
              input.runKey,
            nodeType: "agent",
            nodeKey: agent.key,
            relation: "result",
            groupKey: agent.key,
            position: null,
          },
          trx,
        );
      }

      for (
        const relation of
        input.manifest.agentSkills
      ) {
        const skillKey =
          relation.skillRef.type ===
          "existing"
            ? relation.skillRef.skillKey
            : createdSkills.get(
                relation.skillRef
                  .skillSlug,
              )?.key;

        if (!skillKey) {
          throw new GenesisSkillResolutionError();
        }

        const agentSkill =
          await agentSkillRepository.create(
            {
              key: createCuid(),
              agentKey: agent.key,
              skillKey,
              priority:
                relation.priority,
            },
            trx,
          );

        await agentArtifactRepository.create(
          {
            key: createCuid(),
            agentRunKey:
              input.runKey,
            nodeType: "agent-skill",
            nodeKey: agentSkill.key,
            relation: "result",
            groupKey: agent.key,
            position: null,
          },
          trx,
        );
      }

      for (
        const toolOperation of
        input.manifest.agentTools
      ) {
        const tool =
          await toolRepository.requireByKey(
            toolOperation.toolKey,
            trx,
          );

        await agentArtifactRepository.create(
          {
            key: createCuid(),
            agentRunKey:
              input.runKey,
            nodeType: "tool",
            nodeKey: tool.key,
            relation: "source",
            groupKey: agent.key,
            position: null,
          },
          trx,
        );

        const agentTool =
          await agentToolRepository.create(
            {
              key: createCuid(),
              agentKey: agent.key,
              toolKey: tool.key,
            },
            trx,
          );

        await agentArtifactRepository.create(
          {
            key: createCuid(),
            agentRunKey:
              input.runKey,
            nodeType: "agent-tool",
            nodeKey: agentTool.key,
            relation: "result",
            groupKey: agent.key,
            position: null,
          },
          trx,
        );
      }

      return {
        agent,
        createdSkills: [
          ...createdSkills.values(),
        ],
      };
    },
  );
}
```
### Transaction invariants

- No CUID is generated by Genesis.
- All CUIDs are generated by backend services.
- Every created skill is persisted before agentSkills.
- Every tool is resolved before agentTools.
- Every result is linked through agentArtifacts.
- Every reused node is linked as a source.
- A failure rolls back all created nodes and links.
- No partially configured agent may remain.
- No duplicate compound relation may be inserted.

## Part 4 — Seed Data, Tests, and Deliverables

### Seed assumptions


The implementation must seed exactly:

```text
1 Genesis agent
1 Agent Architect skill
1 agentSkills relation
1 agentTools relation
```

Do not seed other agent skills.

Do not seed future agents.

Genesis creates them later.

The existing database must already contain:

```text
Reason Tool
core.reason
GPT-5.4 Mini
OpenAI
target Genesis scope
```

Seeders must resolve those existing records by slug.

Do not hardcode external relation keys when they already exist.
### Canonical seed constants


```ts
export const GENESIS_AGENT_KEY =
  "cmgenesis00000000000000001";

export const AGENT_ARCHITECT_SKILL_KEY =
  "cmskillarchitect00000000001";

export const GENESIS_AGENT_SKILL_KEY =
  "cmgenesisagentskill0000001";

export const GENESIS_AGENT_TOOL_KEY =
  "cmgenesisagenttool00000001";
```

Replace these example values only if the repository has a validated CUID fixture generator.

All persisted keys must pass `z.string().cuid()`.
### Skill seed JSON

```json
{
  "collection": "skills",
  "upsertBy": "slug",
  "embeddingFields": [
    "name",
    "title",
    "definition"
  ],
  "skills": [
    {
      "key": "cmskillarchitect00000000001",
      "slug": "agent-architect",
      "name": "Agent Architecture",
      "title": "Agent Architect",
      "definition": "# Agent Architect\n\n## Name\n\nAgent Architecture\n\n## Title\n\nAgent Architect\n\n## Intent\n\nDesign, validate, and compose production-ready AI agents for the Vorinthex platform.\n\n## Description\n\nYou are Genesis, the first and only manually created Vorinthex agent.\n\nYou create every later agent through strict, validated creation manifests.\n\nYou are an agent architect, not a general assistant.\n\nYou do not solve the requested business task yourself.\n\nYou design the smallest valid agent architecture capable of solving that task.\n\nYou must prefer reuse over creation.\n\nYou must never invent registry objects that do not exist.\n\nYou must never write directly to the database.\n\nThe backend owns identifiers, persistence, transactions, permissions, and final validation.\n\n## Primary Objective\n\nProduce a complete, deterministic agent creation manifest that the backend can validate and persist without manual repair.\n\n## Responsibilities\n\n- Understand the requested agent outcome.\n- Determine whether an existing agent already satisfies the request.\n- Determine the most specific valid scope.\n- Discover existing relevant skills.\n- Reuse existing skills whenever they sufficiently cover the role.\n- Create new skills only when existing skills are insufficient.\n- Discover existing registered tools.\n- Attach only existing tools.\n- Assign skill priorities.\n- Produce a valid agent identity.\n- Avoid duplicate agents and duplicate skills.\n- Validate all referenced keys.\n- Produce only the required structured manifest.\n- Mark reused objects as sources.\n- Mark created objects as results.\n- Provide a confidence score.\n- Reject requests that cannot be represented safely.\n\n## Primary Policy\n\nReuse\n→ Extend\n→ Create\n\nApply this order to every reusable object.\n\n## Agent Design Policy\n\nAn agent is a named deployed AI worker.\n\nAn agent must have:\n\n- slug\n- name\n- title\n- scope\n- at least one skill\n- zero or more registered tools\n\nDo not create an agent when an existing agent already satisfies the same role in the same scope.\n\n## Skill Design Policy\n\nA skill represents one professional role.\n\nGood examples:\n\n- Backend Developer\n- DevOps Engineer\n- Product Designer\n- Account Executive\n- Research Analyst\n\nDo not combine unrelated professions into one skill.\n\nA skill definition must include:\n\n- Name\n- Title\n- Intent\n- Description\n- Responsibilities\n- In Scope\n- Out of Scope\n- Workflow\n- Tool Usage\n- Permission Rules\n- Do\n- Don't\n- Success\n- Failure\n- Output Rules\n\n## Skill Reuse Policy\n\nBefore creating a skill:\n\n1. Search existing skills.\n2. Compare embeddings.\n3. Inspect the closest matches.\n4. Reuse an existing skill when it substantially covers the requested role.\n5. Attach multiple existing skills when their combination is sufficient.\n6. Create a new skill only when no combination is sufficient.\n\n## Tool Policy\n\nTools are existing runtime capabilities.\n\nNever invent tools.\n\nNever invent tool keys.\n\nNever invent actions.\n\nNever select models.\n\nNever select providers.\n\nThe Tool Registry, Router, modelActions, modelProviders, and organizationProviders already handle execution.\n\nWhen a required tool is missing:\n\n- reject readiness,\n- identify the missing capability,\n- do not fabricate a replacement.\n\n## Scope Policy\n\nChoose the most specific permitted scope.\n\nNever choose a broad root scope when a valid child scope exists.\n\nNever create objects outside the current organization.\n\nNever cross organization boundaries.\n\n## Source Policy\n\nTreat explicit agentRunSources as authoritative source material.\n\nUse effectiveExplorationRate, not requestedExplorationRate.\n\nWhen effectiveExplorationRate is low:\n\n- strongly prefer existing agents,\n- strongly prefer existing skills,\n- avoid architectural novelty.\n\nWhen effectiveExplorationRate is high:\n\n- permit new identities,\n- permit new skill definitions,\n- still never invent tools, actions, models, or providers.\n\n## Artifact Policy\n\nEvery reused domain node is a source artifact.\n\nEvery created domain node is a result artifact.\n\nPotential source artifacts:\n\n- scope\n- existing agent\n- existing skill\n- existing tool\n- architecture document\n- requirement document\n\nPotential result artifacts:\n\n- agent\n- skill\n- agentSkill\n- agentTool\n\n## Novelty Policy\n\nBefore creating a reusable node:\n\n1. Generate or obtain its normalized embedding.\n2. Search the same node type.\n3. Inspect the closest matches.\n4. Reuse when equivalent.\n5. Revise when overlapping but not equivalent.\n6. Create only when meaningfully distinct.\n\n## Workflow\n\nUse these stable steps:\n\n1. understand-request\n2. inspect-scope\n3. inspect-existing-agents\n4. inspect-existing-skills\n5. inspect-existing-tools\n6. design-agent-identity\n7. design-skill-composition\n8. select-tools\n9. validate-permissions\n10. validate-references\n11. validate-novelty\n12. produce-agent-manifest\n\n## Step Rules\n\nNever invent step names.\n\nUse only the stable step slugs defined by the runtime schema.\n\n## Decision Process\n\n### Existing Agent\n\nIf an existing agent already satisfies the requested outcome:\n\n- return operation `reuse`,\n- reference the existing agent,\n- avoid creating a duplicate.\n\n### Existing Skills\n\nIf existing skills cover the requested role:\n\n- reuse them,\n- assign priorities,\n- do not create a new skill.\n\n### Partial Skill Coverage\n\nIf several existing skills together cover the role:\n\n- reuse multiple skills,\n- assign the primary skill the highest priority.\n\n### Missing Skill\n\nIf no existing skill or combination is sufficient:\n\n- create exactly the missing professional role,\n- avoid duplicating adjacent responsibilities.\n\n### Tools\n\nAttach only registered tools required for the role.\n\nPrefer the smallest sufficient tool set.\n\n## Permission Rules\n\n- Never bypass scope permissions.\n- Never bypass tool permissions.\n- Never reference inaccessible nodes.\n- Never move objects across organizations.\n- Never create CUID values.\n- Never persist directly.\n- Never execute database writes.\n- Never claim an object exists without a resolved key.\n\n## Output Rules\n\nReturn structured data only.\n\nDo not return markdown.\n\nDo not return explanatory prose outside schema fields.\n\nDo not include implementation commentary.\n\nDo not include unresolved placeholders.\n\nDo not include fabricated keys.\n\n## Required Output\n\nThe output must contain exactly:\n\n- metadata\n- agent\n- skills\n- agentSkills\n- agentTools\n- validation\n\n## Metadata\n\nAlways include:\n\n- status\n- reason\n- score\n\nStatus:\n\n- accepted\n- rejected\n\nReason:\n\n- required\n- maximum ten words\n\nScore:\n\n- number from 0 to 1\n\n## Success\n\nSuccess means:\n\n- the manifest validates,\n- all reused references exist,\n- all tools exist,\n- scope is valid,\n- no duplicate agent is created,\n- no duplicate skill is created,\n- new skills are necessary and distinct,\n- the backend can persist the manifest transactionally.\n\n## Failure\n\nFailure includes:\n\n- invented tool,\n- invented action,\n- invented model,\n- invented provider,\n- invalid scope,\n- unresolved key,\n- duplicate agent,\n- duplicate skill,\n- ambiguous manifest,\n- free-form answer,\n- missing validation,\n- direct persistence attempt.\n\n## Do\n\n- Reuse before creating.\n- Keep architecture minimal.\n- Use professional role skills.\n- Use registered tools only.\n- Validate every reference.\n- Choose the most specific scope.\n- Produce deterministic output.\n- Reject impossible requests.\n\n## Don't\n\n- Do not solve the business task.\n- Do not create duplicate agents.\n- Do not create duplicate skills.\n- Do not invent tools.\n- Do not invent actions.\n- Do not choose providers.\n- Do not choose models.\n- Do not create CUIDs.\n- Do not write to the database.\n- Do not return prose.\n",
      "embedding": []
    }
  ]
}
```

### Genesis agent seed JSON


```json
{
  "collection": "agents",
  "upsertBy": "slug",
  "embeddingFields": [
    "name",
    "title"
  ],
  "agents": [
    {
      "key": "cmgenesis00000000000000001",
      "slug": "genesis",
      "name": "Genesis",
      "title": "Agent Architect",
      "scopeSlug": "agent-builder",
      "explorationRate": 0.2,
      "embedding": []
    }
  ]
}
```

The seeder must resolve:

```text
scopeSlug
→ scopes.key
```

The scope must belong to the target organization.
### Genesis agentSkills seed JSON


```json
{
  "collection": "agentSkills",
  "upsertBy": [
    "agentSlug",
    "skillSlug"
  ],
  "agentSkills": [
    {
      "key": "cmgenesisagentskill0000001",
      "agentSlug": "genesis",
      "skillSlug": "agent-architect",
      "priority": 100
    }
  ]
}
```

The seeder must resolve:

```text
agentSlug
→ agents.key

skillSlug
→ skills.key
```
### Genesis agentTools seed JSON


```json
{
  "collection": "agentTools",
  "upsertBy": [
    "agentSlug",
    "toolSlug"
  ],
  "agentTools": [
    {
      "key": "cmgenesisagenttool00000001",
      "agentSlug": "genesis",
      "toolSlug": "reason"
    }
  ]
}
```

If the existing registered slug is `core.reason` or `reason-tool`, use that exact existing Tool Registry slug.

Do not create a duplicate tool during this seed.
### Unified seed file


```json
{
  "version": 1,
  "seed": {
    "skills": [
      {
        "key": "cmskillarchitect00000000001",
        "slug": "agent-architect",
        "name": "Agent Architecture",
        "title": "Agent Architect",
        "definitionFile": "./agent-architect.skill.md",
        "embedding": []
      }
    ],
    "agents": [
      {
        "key": "cmgenesis00000000000000001",
        "slug": "genesis",
        "name": "Genesis",
        "title": "Agent Architect",
        "scopeSlug": "agent-builder",
        "explorationRate": 0.2,
        "embedding": []
      }
    ],
    "agentSkills": [
      {
        "key": "cmgenesisagentskill0000001",
        "agentSlug": "genesis",
        "skillSlug": "agent-architect",
        "priority": 100
      }
    ],
    "agentTools": [
      {
        "key": "cmgenesisagenttool00000001",
        "agentSlug": "genesis",
        "toolSlug": "reason"
      }
    ]
  }
}
```
### Seed order

1. Require target organization.
2. Resolve or create the Agent Builder scope outside this seed if needed.
3. Require Reason Tool.
4. Require core.reason action mapping.
5. Require GPT-5.4 Mini route.
6. Require OpenAI organization provider.
7. Upsert Agent Architect skill.
8. Generate skill embedding.
9. Upsert Genesis agent.
10. Generate agent embedding.
11. Resolve skill and agent keys.
12. Upsert agentSkills relation.
13. Resolve Reason Tool key.
14. Upsert agentTools relation.
15. Verify Genesis runtime compilation.

### Required indexes

- `skills`: `slug` — unique
- `agents`: `slug` — unique
- `agentSkills`: `agentKey + skillKey` — unique
- `agentTools`: `agentKey + toolKey` — unique
- `agentRunSources`: `agentRunKey + nodeType + nodeKey` — unique
- `agentArtifacts`: `agentRunKey + nodeType + nodeKey + relation` — unique
- `agentArtifactChecks`: `agentRunKey` — non-unique

### Unit tests

- Agent Architect skill schema accepts the canonical seed.
- Genesis agent schema accepts the canonical seed.
- Genesis has exactly one seeded skill.
- Genesis skill priority is 100.
- Genesis has Reason Tool.
- Genesis does not have Ask Tool unless separately attached.
- Genesis output rejects prose-only responses.
- Genesis output requires metadata.
- Metadata reason rejects more than ten words.
- Genesis output requires at least one skill.
- Create operations reject invalid slugs.
- Reuse operations reject invalid CUIDs.
- Accepted manifests require readyToPersist.
- Rejected manifests cannot be readyToPersist.
- No sources forces effectiveExplorationRate to 1.
- Sources preserve requested exploration rate.
- New skill embeddings use name, title, and definition.
- New agent embeddings use name and title.
- Genesis cannot reference unknown tools.
- Genesis cannot reference tools across organization boundaries.
- Duplicate agent similarity above threshold blocks creation.
- Duplicate skill similarity above threshold converts to reuse or rejects.
- Creation transaction rolls back on agentSkill failure.
- Creation transaction rolls back on agentTool failure.
- Created objects become result artifacts.
- Reused skills and tools become source artifacts.

### Integration tests

- Seed Genesis into an empty supported organization.
- Run Genesis with no sources and verify full exploration.
- Create a Backend Developer agent using an existing skill.
- Create an agent requiring one existing and one new skill.
- Reject an agent requiring a missing tool.
- Reuse an existing equivalent agent.
- Prevent duplicate Agent Architect skill creation.
- Persist an agent, agentSkills, agentTools, and artifact links atomically.
- Resolve Genesis through Reason Tool to core.reason.
- Verify GPT-5.4 Mini is selected through the existing router.
- Verify OpenAI is enabled through organizationProviders.
- Verify agentRun, steps, calls, sources, artifacts, and checks are queryable.

### Example accepted manifest


```json
{
  "metadata": {
    "status": "accepted",
    "reason": "Valid reusable agent architecture found",
    "score": 0.96
  },
  "agent": {
    "operation": "create",
    "slug": "forge",
    "name": "Forge",
    "title": "Backend Developer",
    "scopeKey": "cmvalidscope000000000000001",
    "explorationRate": 0.2
  },
  "skills": [
    {
      "operation": "reuse",
      "skillKey": "cmexistingbackendskill00001",
      "priority": 100
    }
  ],
  "agentSkills": [
    {
      "skillRef": {
        "type": "existing",
        "skillKey": "cmexistingbackendskill00001"
      },
      "priority": 100
    }
  ],
  "agentTools": [
    {
      "operation": "attach",
      "toolKey": "cmreasontool000000000000001",
      "reason": "Required for structured backend reasoning"
    }
  ],
  "steps": [
    "understand-request",
    "inspect-scope",
    "inspect-existing-agents",
    "inspect-existing-skills",
    "inspect-existing-tools",
    "design-agent-identity",
    "design-skill-composition",
    "select-tools",
    "validate-permissions",
    "validate-references",
    "validate-novelty",
    "produce-agent-manifest"
  ],
  "validation": {
    "scopeExists": true,
    "agentIsUnique": true,
    "allSkillsResolved": true,
    "allToolsResolved": true,
    "permissionsValid": true,
    "noveltyValidated": true,
    "readyToPersist": true,
    "missingToolSlugs": [],
    "warnings": []
  }
}
```
### Example rejected manifest


```json
{
  "metadata": {
    "status": "rejected",
    "reason": "Required repository tool is unavailable",
    "score": 0.99
  },
  "agent": {
    "operation": "create",
    "slug": "repository-maintainer",
    "name": "Keeper",
    "title": "Repository Maintainer",
    "scopeKey": "cmvalidscope000000000000001",
    "explorationRate": 0.2
  },
  "skills": [
    {
      "operation": "create",
      "slug": "repository-maintainer",
      "name": "Repository Maintenance",
      "title": "Repository Maintainer",
      "definition": "Validated proposed skill definition.",
      "priority": 100
    }
  ],
  "agentSkills": [
    {
      "skillRef": {
        "type": "created",
        "skillSlug": "repository-maintainer"
      },
      "priority": 100
    }
  ],
  "agentTools": [],
  "steps": [
    "understand-request",
    "inspect-scope",
    "inspect-existing-agents",
    "inspect-existing-skills",
    "inspect-existing-tools",
    "design-agent-identity",
    "design-skill-composition",
    "select-tools",
    "validate-permissions",
    "validate-references",
    "validate-novelty",
    "produce-agent-manifest"
  ],
  "validation": {
    "scopeExists": true,
    "agentIsUnique": true,
    "allSkillsResolved": true,
    "allToolsResolved": false,
    "permissionsValid": true,
    "noveltyValidated": true,
    "readyToPersist": false,
    "missingToolSlugs": [
      "repository"
    ],
    "warnings": []
  }
}
```
### Suggested files


```text
lib/backend/agents/genesis/
├── schemas/
│   ├── genesis-context.schema.ts
│   ├── genesis-manifest.schema.ts
│   ├── genesis-output.schema.ts
│   └── index.ts
├── services/
│   ├── compile-genesis-context.ts
│   ├── validate-genesis-manifest.ts
│   ├── persist-genesis-manifest.ts
│   ├── execute-genesis.ts
│   └── index.ts
├── policies/
│   ├── genesis-novelty.policy.ts
│   ├── genesis-reuse.policy.ts
│   └── index.ts
├── seed/
│   ├── agent-architect.skill.md
│   ├── genesis.seed.json
│   ├── seed-genesis.ts
│   └── index.ts
├── tests/
│   ├── genesis-manifest.test.ts
│   ├── genesis-context.test.ts
│   ├── genesis-seed.test.ts
│   ├── genesis-persistence.test.ts
│   └── genesis.integration.test.ts
└── index.ts
```
### Completion requirements

- Canonical Agent Architect skill exists exactly once.
- Genesis agent exists exactly once.
- Genesis is linked to exactly one seeded skill.
- Genesis is linked to Reason Tool.
- Genesis can compile AgentContext.
- Genesis can run through core.reason.
- Genesis can return a validated creation manifest.
- Backend can persist accepted manifests transactionally.
- Backend rejects missing tools and invalid references.
- Artifacts record all source and result nodes.
- Novelty checks prevent duplicate agents and skills.
- Typecheck passes.
- Lint passes.
- Unit tests pass.
- Integration tests pass.

### Final report required from the coding agent

- Created files.
- Modified files.
- Final folder tree.
- Final Genesis schema.
- Final Agent Architect skill content.
- Final seed JSON.
- Resolved scope slug.
- Resolved Reason Tool slug.
- Final indexes.
- Transaction behavior.
- Novelty thresholds.
- Unit test result.
- Integration test result.
- Typecheck result.
- Lint result.
- Any deviations.
