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
  registry while injecting trusted `ToolContext` identity, organization, and
  scope.
- `email-ingestion-tool-definitions.ts` owns system-only inbox ingestion tools.
  They are registered canonical tools but excluded from model/provider
  definitions and every Core surface.

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
values. Core uses this one capability
for workspace resource retrieval; HTTP and product-specific adapters converge
on the same domain services. Exact counts and sums must come from canonical totals or
exhaustive cursor pagination, never from a truncated result page. Selected-inbox
message and draft queries require an authorized connector selector. Document
summaries requested through `app.search` are bounded, non-persisting previews.
Only explicitly registered additive public fields may be summed. The model must
never aggregate arbitrary fields or bounded search/list examples.
Specialized tools remain separate for similarity and duplicate detection,
signed downloads, persisted generated artifacts, conversation history, and
other semantics that are not ordinary resource queries.

Generated travel references use the same canonical travel service from HTTP
and Core. `trip.guide.generate/list` and the parameterized
`place.reference.generate/list` persist private `tripGuides` or
`placeReferences` rows first, then create ordinary Archive exports just in
time. `placeHeroMedia` owns generated hero bytes; Gallery rows are exports and
do not control Compass lifecycle.

## Adding A Tool

1. Search the existing registry for matching semantics.
2. Add one strict Zod input schema and product-neutral definition.
3. Inject identity, organization, scope, and idempotency from `ToolContext`.
4. Call the canonical service, operation, Content runtime, or action directly.
5. Register the capability in the applicable Core surface and mutation metadata.
6. Add strict-input, authorization, registry uniqueness, and HTTP/Core parity
   tests.

## Calling Actions

A model-backed tool may pass trusted execution options to an action. These
options are dependencies supplied by server code, never fields in the tool's
strict model-visible input schema.

```ts
await executeAction(
  { mode: 'auto', organizationKey: context.organizationKey, actionSlug: 'image' },
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
