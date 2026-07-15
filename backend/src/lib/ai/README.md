# AI Execution Layer & Agent Framework

Modular execution layer for every AI call the backend makes.

```text
Agent → Tool → Action → Router → Model → Provider → Response → Validation → agentRuns
```

A tool never hardcodes a provider endpoint. It references an **action**
(what must be done), and the **router** picks the best executable
model/provider route — restricted to the providers enabled for the calling
organization. Agents compose tools, guardrails allow-list the organization
scopes an agent may operate in, and every execution lands as metadata in
the `agentRuns` ledger.

## Modules (dependency order, bottom-up)

| Module | Owns |
| --- | --- |
| `shared/` | id/dot-notation helpers, normalized token usage, `AiError` base + `Result` |
| `actions/` | `ACTION_SLUGS` (`<domain>.<action>`), `ACTION_REGISTRY`, per-action `safeToRetry` |
| `providers/` | `PROVIDER_SLUGS`, the `ProviderAdapter` contract, one module per provider (auth config, client construction, request transform, response + error + usage normalization, streaming where available), `PROVIDER_REGISTRY` |
| `models/` | `MODEL_SLUGS` (stable internal slugs), `MODEL_REGISTRY` — runtime definitions mirrored by the persisted models, modelActions, and modelProviders collections |
| `organization-providers/` | the `organizationProviders` ArangoDB allow-list: document existence = enabled, no `enabled` boolean, unique persistent index on `(organizationId, providerId)` |
| `router/` | request schemas (`auto` / `model` / `fixed`), candidate generation, centralized strategy weights + deterministic scoring/tie-breaking, `selectRoute`, `executeAction` with organization-safe fallbacks |
| `organization-scopes/` | the `organizationScopes` collection: minimal `{key (CUID2), name}` nodes with a unique name index — the unit guardrails point at |
| `guardrails/` | `{scopeId}`-only guardrail schema + allow-list evaluation: no guardrails → unrestricted; guardrails present → only tools whose scope is listed |
| `tools/` | `TOOL_REGISTRY` — tools reference **actions only** (never providers/endpoints), optionally carry routing *preferences* (router stays authoritative) and a `scopeId` |
| `agents/` | `AgentDefinition` (skill + toolIds + guardrails), SKILL.md compile/parse, deterministic prompt compilation, built-in + runtime agent registry |
| `agent-runs/` | the DB-keyed `agentRuns` ledger: agent decision metadata plus runtime-derived steps, one call per real provider invocation, exact token usage, and timing; never generated content |
| `pipeline/` | `runAgentTool` — grant + guardrail checks, prompt injection for ask-shaped actions, route + execute, response validation, run recording |

**Agents don't chat — agents answer.** The conversational capability is
`core.ask` (via the `ask.answer` tool). An agent's tool grants are its
interaction contract: no `ask.answer` → no conversational surface exists
for that agent, and a UI should render each agent from its tools
(`ask.answer` → message box, `image.create` → prompt-and-image,
`audio.transcribe-file` → audio upload) instead of hardcoding per-agent
screens.

Modules only import downward (providers never import models; models never
import the router; actions import nothing but shared).

## Routing

Modes: `auto` (router picks model + provider), `model` (model fixed,
provider picked), `fixed` (both fixed; **no fallback** unless
`allowFallback: true` — a fixed route is never silently changed).

Strategies: `balanced` (default), `quality`, `speed`, `cost` — weights live
ONLY in `router/scoring.ts`. Ties break deterministically: score →
reliability → quality → model id → provider id. Routing is never random.

Candidate filter chain: action registered → models claiming the action →
mode filters → expand routes → drop disabled models/routes → drop providers
not in `organizationProviders` for the org (loaded server-side, never
client-supplied) → drop providers without a configured adapter → drop
routes lacking an action profile → typed `NoEligibleRouteError` when empty.

Fallbacks only run when the failure allows it: the error must be retryable
AND either the action is `safeToRetry` (text-shaped) or the failure
provably happened before execution (auth / rate-limit / provider down) —
so a retry can never mint a second billable image/video/music output.

## Usage

```ts
import { executeAction } from '@/lib/ai';

const response = await executeAction(
  { mode: 'auto', organizationId, actionId: 'core.ask', strategy: 'quality' },
  { messages: [{ role: 'user', content: 'Hello' }] },
);
// response.output, response.usage {inputTokens, outputTokens, totalTokens}
```

Enable a provider for an organization (existence = enabled; disabling
deletes the document):

```ts
import { createOrganizationProviderService } from '@/lib/ai';

const service = createOrganizationProviderService();
await service.enableProvider(organizationId, 'anthropic');
```

## Provider configuration (env)

| Provider | Env |
| --- | --- |
| openai | `OPENAI_API_KEY` |
| anthropic | `ANTHROPIC_API_KEY` |
| xai | `GROK_API_KEY` (or `XAI_API_KEY`) |
| google-vertex | `GOOGLE_API_KEY` (express mode) |
| azure-ai-foundry | `AZURE_AI_FOUNDRY_API_KEY` + `AZURE_AI_FOUNDRY_ENDPOINT` |
| aws-bedrock | `AWS_BEDROCK_REGION` (explicit opt-in) + `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` |
| openrouter | `OPENROUTER_API_KEY` |

A provider without configuration simply never becomes an eligible route.
Secrets stay inside adapters — registry objects, route decisions, and
errors never carry them.
