# Private Conversations

`service.ts` is the canonical authorization, persistence, ordering,
idempotency, retrieval, and conversation serialization boundary. HTTP handlers
and unified tools call this service directly. AI orchestration delegates to the
canonical Core agent in `../ai/agents`; conversations do not own a second tool
loop.

Every model turn receives the latest 50 completed messages created before the
current user message from the owned current conversation, in chronological
order, plus up to 20 automatically recalled older messages in a separate
internal field. Recall searches completed text messages only across the same
trusted team, scope, and user, excludes the current and recent keys in AQL and
again in service code, and never appears in HTTP or message retrieval output.
Recent context has priority within the shared 250 KB serialization cap. Core
receives the current question separately and can use the public unified tools
it is authorized to call. All `agents.*` entries and
`conversation.message.send` are always excluded from an agent's candidates to
prevent recursion; semantic conversation recall is not a public tool.

Core progressively discloses tools: its initial structured streaming decision
sees grouped authorized slugs only, and full definitions are loaded only for
selected tools. Direct first and later answers stream without exposing JSON
framing through the existing SSE `start`, `delta`, and `done` contract. Direct
answers are forwarded as soon as routing has committed to an empty tool list;
an attempt is retried only before any user-visible delta has been emitted. The
first response may also generate a name, which the repository applies only if
the conversation is still the untouched first turn. Each newly created text
user message has exactly one awaited embedding call whose exact vector is
reused for best-effort indexing and one semantic recall query before the Core
retry loop. Assistant messages receive best-effort background embeddings.
Embedding, indexing, and recall failures fail open independently unless the
request is aborted.

Semantic retrieval filters current-dimension embedded, completed user and
assistant text messages by the authenticated team, scope, and user, verifies
that each owning conversation still exists with the same owner, applies the
strict current-message time boundary and exclusions, and then takes at most 20
by cosine similarity. Current embeddings carry provider, model, and dimension
metadata; migration `0010` adds the owner-wide persistent scan index and the
semantic backfill includes conversation messages.

Text user messages also own a durable, sanitized attachment-reference array.
References contain only the canonical Content document or Gallery image key and
safe file metadata; storage keys and document contents remain private.
Old messages parse with an empty array, while assistant and image-turn messages
cannot carry attachment references.

The upload endpoints use Redis only to reserve uploads and coordinate bounded
preparation transitions. Completion canonicalizes and hashes images, validates
documents without extracting them, enforces the aggregate Core image-byte limit, and writes private
`conversationAttachmentArtifacts` rows before responding. These rows are both
the prepared manifest and durable outbox. `beginTurn` validates and claims every
selected `PREPARED` row in the same Arango transaction that inserts the user and
assistant messages; a replay returns its existing messages without reclaiming.
Core downloads each claimed original document or canonical image once and sends
its private bytes directly as model input.

BullMQ jobs contain only the artifact and user-message identities. The worker
uses per-artifact leases and fencing, deterministic idempotency keys, and the
same canonical document and image persistence paths after Core execution has
started; document extraction is therefore fire-and-forget relative to chat. Trusted canonical PNGs
skip duplicate Sharp canonicalization. Durable recovery republishes claimable
or expired-lease artifacts without Redis. Each artifact settles independently;
the message remains `PENDING` while work is retryable and ends as `COMPLETED`,
`PARTIAL`, or `FAILED`, retaining every successful reference for partial
results. Settlement publishes `conversation.changed`. Expiry cleanup deletes
staged objects and then hard-deletes artifact rows; the 30-day artifact lifetime
exceeds the BullMQ retry retention window.
