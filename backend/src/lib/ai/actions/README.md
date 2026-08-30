# Provider-Neutral Actions

Actions are reusable AI primitives, not user-facing business capabilities.
They describe provider-neutral work such as generation, reasoning, embeddings,
speech, image analysis, web search, and structured extraction.

## Ownership

- `index.ts` is the action registry and execution entry point.
- `types.ts` defines action contracts and provider-routing types.
- Individual action modules define their provider-neutral input/output contract.
- Each `ActionDefinition.models` list owns exact model/provider candidates and
  routing priorities; declaration order breaks equal-priority ties.
- `../providers/registry.ts` owns provider adapters, environment resolution,
  model metadata, and internal-to-external model identifiers. A route is
  operational only when its environment configuration validates.

## Tools Versus Actions

Use a tool when the caller requests a domain outcome: create a folder, find a
place, send an email draft, or update a collection. Use an action when domain
code needs a reusable provider capability: generate text, embed content,
analyze media, or search the web.

A model-backed tool may call an action, but it still owns the domain intent and
must converge with HTTP callers on the same canonical service or operation.
Do not create actions for CRUD, authorization, session issuance, OAuth,
webhooks, or provider credential management.

## Trusted Routes And Retries

Each model-backed action exposes ordered route slots such as `image.primary`
and `image.primary`. Trusted tools may choose those slots through
execution options; model-visible input never accepts provider, model, or
credential selectors. The action resolves each populated slot to its
server-owned provider/model binding.

Pass the trusted options object as the third argument to `executeAction`:

```ts
const response = await executeAction(
  { mode: 'auto', organizationKey, actionSlug: 'text' },
  input,
  {
    providers: ['text.primary'],
    retry: {
      intervalMs: 2_000,
      attempts: 10,
    },
    timeoutMs: 120_000,
    signal,
  },
);
```

`providers` is an ordered array of trusted action route slots, despite its
short name. It does not contain raw provider IDs, model IDs, API keys, or
model-visible values. The slot prefix must match the requested action. Duplicate
slots and slots from another action are rejected. Undeclared optional slots are
ignored when another requested slot is usable; execution fails if no requested
slot is operational.

`retry.intervalMs` is the initial retry delay in milliseconds and defaults to
2,000. `retry.attempts` is the total number of route-cycle attempts and defaults
to 10. Each retry doubles the interval, adds jitter, and caps the delay at 30
seconds. The abort signal also cancels retry waits.

Execution falls through to the next selected route only after a normalized
rate-limit rejection. If every selected route is rate limited, the internal
`queue` action retries the route cycle with capped exponential backoff and
jitter. This is intentionally in-process execution, not a durable BullMQ job.

Non-rate-limit failures do not advance to another provider and are not retried.
Because retries are in process, they do not survive a restart or move between
replicas.
