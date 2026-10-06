# Unified Tools

Tools are the public, product-neutral business capability registry. A tool
expresses domain intent such as `folder.create`, `email.draft.send`, or
`place.find`; it is never a generic database operation or an HTTP wrapper.

## Ownership

- `index.ts` exposes tool names, schemas, provider definitions, and `runTool`.
- `tool-definitions.ts` assembles the single public registry.
- `content-schemas.ts`, `content-registry.ts`, and `content-runtime.ts` own
  Archive contracts and execution.
- `workspace-tool-definitions.ts` adapts Core capabilities into the public
  registry while injecting trusted `ToolContext` identity, team, and
  scope.
- `email-ingestion-tool-definitions.ts` owns system-only inbox ingestion tools.
  They are registered canonical tools but excluded from model/provider
  definitions and every Core surface.
- `account-tool-definitions.ts` owns authenticated permanent account deletion
  and workspace picker updates. They are registered for transport parity but
  intentionally excluded from every model/provider definition and Core surface.
- `ticket-tool-definitions.ts`, `notification-tool-definitions.ts`, and
  `commerce-tool-definitions.ts` adapt support, notification, and catalog/subscription reads
  operations to their canonical services. HTTP and registered tools share
  those service implementations.
- `referral-summary-read.ts` and `referral-redeem.ts` expose the current user's
  referral summary and redemption through the same referral service as HTTP.

## Required Layering

```text
HTTP handler or Core capability -> unified tool -> canonical service/operation
```

HTTP handlers validate transport input only. Tools define strict model-visible
input and inject trusted authorization context. Canonical services and
operations enforce authorization, invariants, transactions, idempotency, and
external-side-effect recovery. HTTP and Core callers must converge on that
same canonical implementation.

Every user-facing business capability and CRUD operation needs one
product-neutral dot-notation tool. Authentication, OAuth, webhooks, SSE,
health checks, and signed-byte transfers are protocol boundaries rather than
tools. Never expose generic database, arbitrary query, or credential-management
tools.

Protocol boundaries may dispatch a system-only business tool after authenticating
and reducing provider input to trusted server selectors. Gmail OAuth schedules
`inbox.sync`; verified Gmail Pub/Sub delivery schedules `inbox.subscribe`. Both
ingestion tools and the model-visible `inbox.sort` operation converge on the same
canonical thread sorter and persistence path.

`app.search` is the canonical collection-aware workspace query. Its registered
collection adapters declare their supported `search`, `list`, `count`, `sum`, `get`,
and `summarize` operations, accepted filters, public fields, and valid status
values. Core's server-owned evidence assembler uses this same canonical service
for workspace retrieval; HTTP and product-specific adapters converge
on the same domain services. Exact counts and sums must come from canonical totals or
exhaustive cursor pagination, never from a truncated result page. Selected-inbox
message and draft queries require an authorized connector selector. Document
summaries requested through `app.search` are bounded, non-persisting previews.
For location-scoped root views, `filters.rootOnly: true` restricts folders,
documents, and files to direct root items before ranking and result limits.
It is mutually exclusive with `folderKey` and `includeDescendants`.
Only explicitly registered additive public fields may be summed. The model must
never aggregate arbitrary fields or bounded search/list examples.
Specialized tools remain separate for similarity and duplicate detection,
signed downloads, persisted generated artifacts, conversation history, and
other semantics that are not ordinary resource queries.

`agent.context` is a legacy single-pass read tool. Its strict input is an
empty object; the server supplies the current user request, authorized
`ToolContext`, and recent conversation context. It assembles bounded deep
evidence through existing canonical read services, without passing database
keys to Core. Jev's `decide` action selects sources inside this single tool call.

Core now uses `agent.query` for current-scope workspace reads. It has three
strict modes: `count` computes exact authorized file totals through nested
folders, `list` returns an exact total plus up to 50 compact, navigable file
entries with an opaque next-page cursor, and `retrieve` selects up to ten authorized file records after vector,
filename keyword, and applicable metadata rankings are fused with RRF and up
to 50 candidates are reranked. File text is bounded and marked partial when
shortened. Trusted recent references resolve directly. An optional input includes the authorized retrievals
from the latest ten messages, revalidated against current scope ownership.
Navigable result keys are projected only into the conversation's trusted
evidence channel, not the model-facing query result.

Examples (the server injects user identity and the current scope):

```json
{"mode":"count","folder":{"name":"Chats"}}
{"mode":"count","folder":{"name":"Work"},"field":"extension"}
{"mode":"list","extensions":["mp4"]}
{"mode":"list","nextPage":true}
{"mode":"retrieve","query":"dinner menu at Granna"}
{"mode":"retrieve","reference":{"recent":true},"includeRecentReferences":true}
```

`count` and `list` include files in every descendant folder; count distinguishes
direct from nested files. List returns all matching files when there are at
most 50, otherwise reports the exact total and a cursor for the next page.
`retrieve` collects up to 100 hits per applicable ranking
lane before loading the best ten bounded file records. Folder and recent-file selectors are reauthorized,
and a missing or ambiguous folder never reports a complete zero count.
`agent.context` remains registered for legacy callers.

`agent.greet` generates a brief opening through the provider-neutral text action
using the authorized user's context. Its strict input accepts only a server-owned
occasion. The greeting SSE boundary invokes the same tool, streams text deltas,
and issues a short-lived token so an opening can be included when a chat begins.
No guide topics or suggestions are generated.

Generated travel references use the same canonical travel service from HTTP
and Core. `trip.guide.generate/list` and the parameterized
`place.reference.generate/list` persist private `tripGuides` or
`placeReferences` rows first, then create ordinary Archive exports just in
time. `placeHeroMedia` owns generated hero bytes; Gallery rows are exports and
do not control Compass lifecycle.

## Adding A Tool

1. Search the existing registry for matching semantics.
2. Add one strict Zod input schema and product-neutral definition.
3. Inject identity, team, scope, and idempotency from `ToolContext`.
4. Call the canonical service, operation, Content runtime, or action directly.
5. Register the capability in the applicable Core surface and mutation metadata.
6. Add strict-input, authorization, registry uniqueness, and HTTP/Core parity
   tests.

## Document Ingestion

`document.parse` is the sole public ingestion capability for uploaded files and
ordered scanned-page images. Both input forms share the same canonical parser,
source ownership, rollback, and embedding persistence. PDF/image transcription
calls the existing `text` AI action with Core's native file/image transport and a
server-owned faithful-transcription prompt. Ingestion is action-token priced;
there is no fixed upload or scan charge and no separate public scan tool.

Mobile document and scan uploads reserve short-lived `pending/content/` objects
through `/content/uploads/presign`, PUT the bytes directly to S3, and submit
reservation keys through `/content/uploads/complete`. Completion verifies the
objects and invokes the same `document.parse` Content tool as Core; the signed
transfer endpoints are protocol boundaries, not additional public tools.

## Calling Actions

A model-backed tool may pass trusted execution options to an action. These
options are dependencies supplied by server code, never fields in the tool's
strict model-visible input schema.

```ts
await executeAction(
  { mode: 'auto', teamKey: context.teamKey, actionSlug: 'image' },
  actionInput,
  {
    providers: ['image.primary'],
    retry: { intervalMs: 2_000, attempts: 10 },
    timeoutMs: context.timeoutMs,
    signal: context.signal,
  },
);
```

The `providers` array contains ordered action route slots. The action registry
maps those slots to exact providers and models. `retry.intervalMs` controls the
initial exponential-backoff interval, while `retry.attempts` controls the total
number of full route cycles. Defaults and failure behavior are documented in
[the actions guide](../actions/README.md).
