# AI metadata model and runtime

The backend stores identity, permissions, routing, and execution history as
separate ArangoDB nodes:

```text
Agent -> agentSkills -> Skills
                         -> Actions -> Router
                                             -> modelActions -> Models
                                             -> modelProviders -> Providers
                                             -> organizationProviders
                                             -> agentRuns / steps / calls
                                             -> run sources / artifact provenance / novelty checks / memories
                                             -> reverse context compiler / knowledge packs
```

All domain documents expose `key`; only the shared database boundary maps it
to ArangoDB `_key`. Registry relationships use persisted CUID keys and
lower-camel-case collection names.

## Runtime compilation

Every execution calls `loadAgentRuntime` and `compileAgentContext` afresh. The
loader resolves the agent's effective scope through `scopeAgents`, resolves its
organization, and orders linked skills by descending `priority`. The
context compiler then resolves runtime variables, reusable memories, explicit
artifact sources, permissions, guardrails, and exploration policy. Agents only
receive this value; they never receive repositories or query storage.

Before context compilation, the execution entry point requires a trusted
server-side principal. Member execution resolves an active `userOrganizations`
document, its user, and the matching `scopeMembers` document. All three must
belong to the agent's organization and scope. This identity is never accepted
inside the client request body. Trusted internal workflows use an explicit
system principal instead.

`AgentContext` contains:

1. organization, scope, and agent identity;
2. ordered skills;
3. precedence-resolved runtime variables and scoped memories;
4. compact artifact references, never full documents by default;
5. `{ "scopeId": scopeAgents.scopeKey }` guardrails;
6. source policy and the current task.

Agents persist only `explorationRate` (`0` through `1`). Context exposes the
requested rate, effective rate, and source count. With no sources, exploitation
is impossible and the effective rate is always `1`; otherwise it equals the
requested rate. There is no `selfSustaining` flag.

## Reverse context compilation

Searchable storage nodes cross the runtime boundary only through a registered
`NodeResolver`. Its normalized node contract contains ownership, scope,
embedding, and the ordered `embeddingFields`; the corresponding `fields` map
is forbidden from containing anything else. Resolvers authorize `exists`,
`load`, vector `findSimilar`, and `extractContext` operations before returning
data.

`ReverseContextCompiler` embeds the current task, takes the best 20 vector
matches by default, merges explicit run sources, and emits normalized
`KnowledgeBlock` values. Manual sources always rank above automatic matches;
automatic ranking combines similarity, manual priority, and freshness. The
knowledge-pack builder then deduplicates, trims, optionally summarizes, and
drops the lowest-ranked blocks until its runtime-owned token budget is met.
Summary packs always contain references and compact summaries with
`content: null`; complete safe content is lazy-loaded through `artifact.read`,
which repeats agent context, organization, scope, and resolver permission
checks. Raw rows, Arango metadata, embeddings, and
undeclared fields never enter provider context.

## Artifact sources, provenance, and novelty

Business artifacts remain domain objects in their own collections. There is no
generic artifacts collection. `agentRunSources` records the explicit, ordered
source selection for a run. A node-type resolver validates existence,
organization ownership, and scope/custom permissions, then returns only
`nodeType`, `nodeKey`, `name`, and `summary` to the context. Full content stays
behind the resolver's `getContent` capability for runtime tools.

`agentArtifacts` is a provenance link with `nodeType`, `nodeKey`, `relation`,
`groupKey`, and `position`. The execution pipeline records every selected source
both as an `agentRunSources` row and as an `agentArtifacts` `source` relation.
Results, attachments, and intermediates use the same relation repository.

Before a domain service persists a candidate artifact,
`checkArtifactNovelty` embeds its semantic text and asks that node type's
resolver for nearest neighbors. Per-type review/reject thresholds decide
whether it is accepted, requires revision or optional validation, or is
rejected. Review/reject outcomes are auditable in `agentArtifactChecks`.
Built-in policies match the architecture specification for hooks, images, and
blog posts; new artifact types must register both a resolver and a policy.

Direct actions contain no provider or model selection. Provider routing uses
the requested action slug and retains the model/provider relation checks.

## Routing

`selectRoute` accepts `auto`, `model`, or `fixed` mode. It resolves persisted
relations and selects deterministically using `modelActions.priority` only:

1. require an enabled action;
2. load enabled `modelActions`, highest priority first;
3. apply an optional requested model;
4. require an enabled model;
5. load enabled `modelProviders`;
6. apply an optional fixed provider;
7. require an `organizationProviders` allow-list document;
8. require an enabled provider and configured adapter;
9. return the first valid route.

There is no random choice, quality/cost/speed scoring, or execution fallback.

Organization, organization-member/provider, scope, scope-member/agent,
agent-member, and access evaluation/explanation tools use a separate local
execution boundary.
GPT-5.4 Mini routes only through `core.reason` to select one direct action and
produce arguments matching its JSON schema. `runDomainAgentTool` then reloads
the agent context, resolves the initiating human, validates the input
with Zod, enforces organization and scope RBAC, and executes the local handler.
These deterministic domain actions intentionally have no `modelActions` rows:
models may interpret intent but can never perform database mutations directly.
Mutations use Arango stream transactions and emit domain audit events.

`scopeAgents` is the authoritative lifecycle and minimum-role link between a
scope and an existing agent definition. `agentMembers` stores inherited and
explicit grants separately. Every AgentRun reloads these relations and requires
an active organization, active scope, active scope-agent link, valid scope
access, and at least one valid agent grant. Access explanations render the
structured decision returned by the same evaluator used for enforcement.
A fixed route never bypasses organization provider permissions.

## Execution and validation

`runStoredAgentTool` is the secure public execution entry point. It resolves
agent, skill, action, model, and provider routing server-side. Every output
has strict metadata:

```ts
{
  status: 'accepted' | 'rejected';
  reason: string; // at most ten words
  score: number;  // 0 through 1
}
```

A rejected preflight is written as a rejected run and executes no tool or
model call. Accepted executions validate the provider response and record real
provider token usage. The accepted run and its source provenance are persisted
before the provider is invoked, so artifact-producing tools have a stable run
key throughout execution; completion then updates that same summary row. Each
invocation creates one `agentRunCall`.

Execution storage is deliberately split:

- `agentRuns`: small status, reason, score, and timing summary;
- `agentRunSteps`: stable logical step occurrences;
- `agentRunCalls`: authoritative model/provider/token ledger;
- `agentArtifacts`: run-to-artifact links;
- `agentRunSources`: explicit ordered inputs;
- `agentArtifactChecks`: duplicate and novelty decisions;
- `agentMemories`: explicitly selected reusable knowledge only.

Every new run also records `principalType` and, for member executions,
`userOrganizationKey`, making the organization and scope authorization path
auditable without placing user profile data in model context.

The generic `events` timeline records only stable lifecycle slugs:
`agent.*`, `step.*`, `model.*`, `artifact.created`,
`artifact.used`, and `guardrail.blocked`. Payloads contain relation keys,
status, timing, and token counts only. Full inputs, outputs, and artifacts stay
in the run, call, and domain collections. Every runtime event takes `scopeId`
from the loaded `scopeAgents` relation, never from a client request.

Legacy run documents that cannot supply trustworthy foreign keys or token
usage are retained in `agentRunsLegacy`; they are never fabricated into the
new call ledger.

## Provider configuration

Adapters read credentials from environment configuration. Credentials are
never stored in ArangoDB. Supported adapter identifiers are OpenAI,
Anthropic, xAI, Google Vertex, Azure AI Foundry, AWS Bedrock, and OpenRouter;
v1 persists only the OpenAI provider and routes GPT-5.4 Nano to Ask and
GPT-5.4 Mini to Reason.
