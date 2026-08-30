# AI actions and routing

Provider-neutral actions own their exact model/provider candidates and routing
priorities. Callers invoke the action without depending on provider APIs.

Detailed guides:

- [Providers](providers/README.md)
- [Actions](actions/README.md)
- [Unified tools](tools/README.md)

## Routing

`selectRoute` resolves the action from the code registry and considers its exact
declared model/provider bindings by descending priority, using declaration order
to break ties. The provider code registry resolves model metadata, external
model identifiers, adapters, and environment configuration. Fixed model or
provider selection does not bypass registry or environment validation.

Actions with `none` policy or no declared bindings are not routable. A
`configurable` action becomes routable only when its code definition declares
bindings; there is no persisted action-to-model routing collection.

Product capabilities use the unified tool registry and invoke canonical domain
services directly. Tools receive trusted organization, scope, membership, and
request context from their authorized caller rather than model-visible input.

## Provider configuration

Adapters read credentials from environment configuration. Credentials are
never stored in ArangoDB.
