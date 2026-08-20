# Provider-Neutral Actions

Actions are reusable AI primitives, not user-facing business capabilities.
They describe provider-neutral work such as generation, reasoning, embeddings,
speech, image analysis, web search, and structured extraction.

## Ownership

- `index.ts` is the action registry and execution entry point.
- `types.ts` defines action contracts and provider-routing types.
- Individual action modules define their provider-neutral input/output contract.
- `modelActions.actionSlug` is the persisted model-routing identity.

## Tools Versus Actions

Use a tool when the caller requests a domain outcome: create a folder, find a
place, send an email draft, or update a collection. Use an action when domain
code needs a reusable provider capability: generate text, embed content,
analyze media, or search the web.

A model-backed tool may call an action, but it still owns the domain intent and
must converge with HTTP callers on the same canonical service or operation.
Do not create actions for CRUD, authorization, session issuance, OAuth,
webhooks, or provider credential management.
