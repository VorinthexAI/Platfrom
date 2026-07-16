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
                                             -> agentRuns / steps / calls / artifacts / memories
```

All domain documents expose `key`; only the shared database boundary maps it
to ArangoDB `_key`. Registry relationships use persisted CUID keys and
lower-camel-case collection names.

## Runtime compilation

`loadAgentRuntime` loads the agent and its scope, orders linked skills by
descending `priority`, resolves explicitly granted `agentTools`, then loads
the tools and their enabled action links. `compileAgentRuntimeContext` builds:

1. agent identity;
2. scope context and `{ "scopeId": agent.scopeKey }` guardrail;
3. ordered skill definitions;
4. available tools, actions, and permissions;
5. output schema;
6. current task.

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
provider token usage. Each invocation creates one `agentRunCall`.

Execution storage is deliberately split:

- `agentRuns`: small status, reason, score, and timing summary;
- `agentRunSteps`: stable logical step occurrences;
- `agentRunCalls`: authoritative model/provider/token ledger;
- `agentArtifacts`: run-to-artifact links;
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
