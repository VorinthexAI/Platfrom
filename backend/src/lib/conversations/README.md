# Private Conversations

`service.ts` is the canonical authorization, persistence, ordering,
idempotency, retrieval, and conversation serialization boundary. HTTP handlers
and unified tools call this service directly. AI orchestration delegates to the
canonical Core agent in `../ai/agents`; conversations do not own a second tool
loop.

Every model turn receives the latest 50 completed user and assistant messages
from the owned current conversation, in chronological order, plus the user's
current question separately. Core can use the public unified tools it is
authorized to call. All `agents.*` entries and `conversation.message.send` are
always excluded from an agent's candidates to prevent recursion.

`agent.query` has a strict input containing only a semantic query and an
optional limit of at most 20. It searches
completed private user and assistant messages across the authenticated user's
conversations in the current organization and scope, and is used only when
context beyond the supplied recent messages is needed.

Core progressively discloses tools: its initial structured streaming decision
sees grouped authorized slugs only, and full definitions are loaded only for
selected tools. Direct first and later answers stream without exposing JSON
framing through the existing SSE `start`, `delta`, and `done` contract. The
first response may also generate a name, which the repository applies only if
the conversation is still the untouched first turn. Both completed user and
assistant messages receive best-effort embeddings; indexing failures cannot
reclassify an otherwise completed business operation as failed.

Semantic retrieval filters embedded, completed user and assistant messages by
the authenticated organization, scope, and user, verifies that each owning
conversation still exists with the same owner, and then takes the top requested
limit by cosine similarity.
