# AI Providers

Providers are transport adapters for external AI services. They translate
provider-neutral action contracts into provider requests and normalize output,
usage, cost, streaming events, and errors.

## Ownership

- `registry.ts` owns provider registration, model metadata, environment
  resolution, and internal-to-external model identifiers.
- `types.ts` owns normalized provider contracts shared by adapters and routing.
- `errors.ts` owns provider error normalization.
- `openrouter.ts` owns the external model API transport behavior. AWS Textract
  remains a provider-neutral file-processing implementation outside this model
  provider registry.

Credentials and model configuration come from trusted environment variables.
They are never accepted through model-visible tool or action input and are
never stored in the database.

## Route Slots

Actions bind trusted slots such as `text.primary` and `image.primary` to exact
provider/model pairs. Callers select slots through the action execution
options documented in [the actions guide](../actions/README.md). They do not
pass raw provider credentials or external model identifiers.

An unavailable provider is skipped during route selection. An optional slot
that is not declared by the action is also ignored when another requested slot
is usable. Execution fails when no requested route is operational.

## Adding A Provider

1. Implement the normalized adapter contract without domain business logic.
2. Register its environment schema, factory, models, and external identifiers.
3. Bind it to an action slot rather than selecting it inside a tool.
4. Add contract tests for success, malformed output, normalized errors,
   timeouts, and streaming when supported.
5. Add a bounded live smoke test when credentials and API cost permit it.
