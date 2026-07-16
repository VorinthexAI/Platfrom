# AI metadata model and runtime

The backend stores identity, permissions, routing, and execution history as
separate ArangoDB nodes:

```text
Agent -> agentSkills -> Skills
      -> agentTools  -> Tools -> toolActions -> Actions
                                             -> Router
                                             -> modelActions -> Models
                                             -> modelProviders -> Providers
                                             -> organizationProviders
                                             -> agentRuns / steps / calls
                                             -> run sources / artifact provenance / novelty checks / memories
```

All domain documents expose `key`; only the shared database boundary maps it
to ArangoDB `_key`. Registry relationships use persisted CUID keys and
lower-camel-case collection names.

## Runtime compilation

Every execution calls `loadAgentRuntime` and `compileAgentContext` afresh. The
loader resolves the organization and scope, orders linked skills by descending
`priority`, and loads explicitly granted tools and their enabled actions. The
context compiler then resolves runtime variables, reusable memories, explicit
artifact sources, permissions, guardrails, and exploration policy. Agents only
receive this value; they never receive repositories or query storage.

`AgentContext` contains:

1. organization, scope, and agent identity;
2. ordered skills and explicitly granted tools;
3. precedence-resolved runtime variables and scoped memories;
4. compact artifact references, never full documents by default;
5. derived permissions and `{ "scopeId": agent.scopeKey }` guardrails;
6. source policy and the current task.

Agents persist only `explorationRate` (`0` through `1`). Context exposes the
requested rate, effective rate, and source count. With no sources, exploitation
is impossible and the effective rate is always `1`; otherwise it equals the
requested rate. There is no `selfSustaining` flag.

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

Tools contain no provider or model selection. A UI can derive surfaces from
the grants: `ask.answer` exposes chat, `image.create` exposes image generation,
and `audio.transcribe-file` exposes audio upload. Without Ask Tool, direct chat
must not be shown and the persisted pipeline rejects that execution.

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
A fixed route never bypasses organization provider permissions.

## Execution and validation

`runStoredAgentTool` is the secure public execution entry point. It resolves
agent, skill, tool, action, model, and provider keys server-side. Every output
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

Legacy run documents that cannot supply trustworthy foreign keys or token
usage are retained in `agentRunsLegacy`; they are never fabricated into the
new call ledger.

## Provider configuration

Adapters read credentials from environment configuration. Credentials are
never stored in ArangoDB. Supported adapter identifiers are OpenAI,
Anthropic, xAI, Google Vertex, Azure AI Foundry, AWS Bedrock, and OpenRouter;
v1 persists only the OpenAI provider and routes GPT-5.4 Nano to Ask and
GPT-5.4 Mini to Reason.
