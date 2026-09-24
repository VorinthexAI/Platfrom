# Internal Agents

Internal agents are server-owned AI orchestrators over the provider-neutral
`text` action and the unified public tool registry. `index.ts` owns the bounded
native streamed tool loop, allowlist expansion, canonical `runTool`
dispatch, deterministic per-call idempotency, and safe tool-status feedback.
`core.ts` defines Core; `schemas.ts` owns strict internal and public contracts.

An empty allowlist authorizes all model-visible public unified tools. Exact
slugs and namespace wildcards such as `folder.*` are supported and deduplicated.
Each agent also owns `excludedTools`, which supports the same exact and wildcard
patterns and is applied after its allowlist.
All `agents.*` tools and `conversation.message.send` are excluded from every
agent candidate set to prevent recursive orchestration.
Model selections and native calls are untrusted and rechecked before each
dispatch.

Core has exactly one model-facing read tool, `agent.context`, and invokes it only
when the current request needs private workspace or account data. It is removed
from subsequent model turns after one invocation; general questions skip it.
`workspace-context.ts` sends the trusted current request and collection catalog
to the provider-neutral `decide` action (TypeSafe Jev via the OpenRouter Decisions
API). The returned choices select read modes only, not database keys, arbitrary
queries, or authority. Canonical collection services then perform scoped discovery,
exact counts, relationship expansion, and detail reads in parallel. The model
receives bounded, allowlisted JSON without database identifiers. Navigation
references remain server-side for conversation persistence. Missing or truncated
sources carry explicit coverage status rather than implying zero results. Core
streams one answer after the tool result; image creation remains a separate mutation.

Tools execute only through canonical `runTool` adapters with trusted
`ToolContext` and hashed per-call request keys. Equal call fingerprints share
the same in-flight promise, including within parallel batches. Tool failures
become safe failed
statuses so the model can recover. Arguments, context, results, and errors are
bounded and treated as untrusted data; oversized successful results are
reported with an omission marker rather than truncated. Production arguments
are strict-schema validated before dispatch. Routing and tool telemetry contains
only stage, outcome, counts,
confidence class, and duration, never request or result payloads. The public `agents.core` tool has
one strict model input and lazily imports Core so `agents -> tools -> agents`
does not create an eager initialization cycle. Its adapter injects the system
prompt, current ISO date, request key, identity, team, and scope. Conversation
titles are generated locally from the first current user message, never by the
model.

## Focused evaluation

`workspace-context.test.ts` covers focused cross-collection and
account-grounding scenarios, including deep reads, exact counts, redaction,
ambiguity, and unavailable sources. `core.test.ts` verifies that Core either
answers directly or calls `agent.context` once before its final answering turn.
The OpenRouter provider tests cover Jev's Decisions API transport.

With `OPENROUTER_API_KEY` already in the process environment, these focused
tests additionally run five Jev routing/timing cases and three live Core
tool-selection cases. They use synthetic questions and injected account data,
report Jev p50/p95 latency, and never print or persist the credential.

The attachment performance evaluation compares direct-provider execution with
the complete upload, canonicalization, conversation SSE, and asynchronous
persistence pipeline across text files, small images, realistic large images,
and mixed attachment sets:

```bash
bun run --cwd backend test:e2e:core-attachments-performance
```

Use `--provider-only`, `--core-only`, or `--pipeline-only` to isolate one path,
`--scenario=two-realistic-images` to isolate one fixture set, and `--repeat=3`
to collect repeated measurements. The evaluation records each upload phase,
first answer delta, terminal-frame tail, persistence convergence, and premature stream EOFs. Remote execution is refused unless
`CORE_ATTACHMENT_EVAL_DANGEROUS_REMOTE=true` is set.

The multilingual embedding smoke evaluation compares Swedish, Spanish,
German, and misspelled English workspace queries with relevant and unrelated
English resource descriptions using the configured production embedding model:

```bash
bun run --cwd backend test:embeddings:multilingual-live
```
