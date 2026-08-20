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

## Adding A Tool

1. Search the existing registry for matching semantics.
2. Add one strict Zod input schema and product-neutral definition.
3. Inject identity, organization, scope, and idempotency from `ToolContext`.
4. Call the canonical service, operation, Content runtime, or action directly.
5. Register the capability in the applicable Core surface and mutation metadata.
6. Add strict-input, authorization, registry uniqueness, and HTTP/Core parity
   tests.
