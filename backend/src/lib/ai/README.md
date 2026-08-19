# AI actions and routing

Provider-neutral actions contain no provider or model selection. Provider
routing uses the requested action and persisted model/provider relations.

## Routing

`selectRoute` resolves the action from the code registry, then resolves
persisted relations by `modelActions.actionSlug` and selects deterministically
using `modelActions.priority`. Operational enablement belongs to the persisted
model-action relation, model, model-provider relation, and organization provider
access. There is no separately persisted action enablement gate. Fixed model or
provider selection does not bypass those checks.

Actions with `configurable` model policy may have no code-seeded bindings;
operator-created `modelActions` rows remain the routing source for those actions.

Product capabilities use the unified tool registry and invoke canonical domain
services directly. Tools receive trusted organization, scope, membership, and
request context from their authorized caller rather than model-visible input.

## Provider configuration

Adapters read credentials from environment configuration. Credentials are
never stored in ArangoDB.
