# Private Conversations

`service.ts` is the canonical authorization, persistence, ordering,
idempotency, retrieval, and model-tool-loop boundary. HTTP handlers and unified
tools call this service directly.

Every model turn initially receives only the user's current question and one
optional tool, `assistant.query`. History is never loaded automatically. The
tool input contains only a semantic query and optional bounded limit; the
service injects the authenticated organization, scope, user, and current
conversation before embedding and retrieval.

The first completed turn uses the provider-neutral text action's strict
structured response format to produce `{name,response}`. Because naming and
tool selection must be validated atomically, that turn is non-streaming at the
provider boundary and is emitted through the same SSE `start`, `delta`, and
`done` contract. Later answers use provider-neutral streaming, including one
optional streamed `assistant.query` call. A second tool call is never exposed,
which prevents recursive retrieval.

Retrieval filters completed assistant messages to the current private
conversation before cosine ranking, takes at most 50, orders the selected
messages chronologically, and drops the oldest selected messages until the
serialized safe projection is within a 10,000 estimated-token budget. The
default deterministic estimator conservatively counts one token per UTF-8
byte; callers may inject an exact counter for the selected model.
