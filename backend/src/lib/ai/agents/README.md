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

Core uses `agent.query` for one authorized workspace read. It chooses `count`
for exact file counts through all nested folders, `list` for an exact total and
up to 50 compact files per inventory page, or `retrieve` for independent
vector and filename keyword lanes plus metadata when file type or folder
filters apply. RRF fuses the ranks into at most 50 authorized
candidates. The provider-neutral `rerank` action chooses the best ten records;
rerank failures fall back to RRF order. Text in the ten records is bounded and
marked partial if shortened. List cursors are random Redis-backed tokens,
validated against the authorized user, scope, and filters. A later turn can
continue the saved conversation cursor without exposing file keys. The
trusted server can revalidate references from the latest ten chat messages;
model input and output never include user, scope, or raw storage keys. Selected
results emit navigable references through `onEvidence`. Unresolved folders are
partial results, never complete zero counts. `workspace-context.ts` still
serves legacy `agent.context` callers, but is not in Core's allowlist.
Core selects modes and filters from the tool descriptions, rather than
application-maintained language term lists. A provider-neutral intent decision
identifies requests for facts inside stored files; these require a workspace
read and normalize `agent.query` to retrieve before its single read is spent.
Inventory and count requests retain their original modes. If a required read
does not happen, Core does not present an unverified answer. Retrieve mode can request a minimum
number of distinct sources for comparisons; insufficient evidence is partial.

`fresh-read.ts` checks shared phrases against authorized indexed data on
ambiguous follow-ups before requiring a fresh read of potentially stale prose.

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

Use the two strict `agent.query` modes to verify exact nested counts, ten-file
retrieval from the fused and reranked pool, and follow-ups using the latest ten
authorized message references. Core calls its read capability at most once per
answer and reports partial evidence when a folder or file is unresolved.

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
