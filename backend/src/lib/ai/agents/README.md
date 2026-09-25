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

Core uses `agent.query` for one batched read when the current request needs
private data in Archive, Gallery, Signal, Compass, or Ascend. The current-scope
ArangoSearch view indexes approved fields on original records and stays in sync
with database writes. Named resources are discovered in the view, then
reauthorized and hydrated through canonical services. Collection/image and
inbox/thread relationships use the owning services. Exact counts and sums
come from canonical operations, not bounded search hits. The trusted server
stores selected parent references with the conversation for follow-up turns;
authorized search/list/get results also emit navigable references through the
trusted `onEvidence` channel. Completed conversation messages persist up to
four retrieval groups; the mobile Core pill sheet opens their destination
screens. Core never receives raw resource keys. `workspace-context.ts` still serves
legacy `agent.context` callers, but is not in Core's allowlist.

`fresh-read.ts` checks whether a phrase shared by the latest question and
recent conversation resolves to authorized indexed data. When it does, the
first Core provider call requires `agent.query`, instead of allowing an answer
from potentially stale history. This is an indexed data check, not a list of
language-specific keywords, and it does not add a model/tool round trip.

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

`workspace-query.test.ts` exercises batched canonical reads, named parent
resolution, exact aggregates, follow-up references, and a deterministic Core
turn transcript in `workspace-query-transcript.txt`. `core.test.ts` verifies
that Core answers directly or calls its read capability once before answering.

For a paid end-to-end check with the real model and local ArangoDB, run
`bun run --cwd backend test:e2e:core-query-live`. This loads the unlocked dev
provider configuration, creates a disposable database with a dummy user and
linked Archive, Gallery, Signal, Compass, and Ascend data, then attempts 50
persistent paid conversation turns. The fixture includes a real PNG in local S3
and verifies native index create/edit/delete behavior. It drops the temporary
database and removes the PNG, and refuses non-local database/storage hosts.
Every actual question, answer, tool call, evidence result, and heuristic verdict
is written to `backend/scripts/core-query-live-transcript.txt`. For a focused
paid recheck use `bun run --cwd backend test:e2e:core-query-live --turns=13,17,28`;
it writes `backend/scripts/core-query-live-recheck.txt` without overwriting the
50-turn record. The original low-scoring run is preserved as
`backend/scripts/core-query-live-baseline.txt` so changes can be compared. A
verdict checks selected fixture facts and tool outcomes; the complete answer
still needs review for unsupported extra claims. The deterministic no-provider
transcript remains separate.
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
