# Events

Events are scoped analytics records, not a financial ledger. Every event has a product-neutral dotted slug, an app attribution, a trusted scope, completion status, and optional token usage. Authenticated custom ingestion accepts only the slug; user, scope, and app attribution come from the request context.

`observeToolExecution` is the shared tool boundary. It records successful and failed executions, aggregates action and token observations made inside the tool, and applies the configured Spark cost after successful work. Tool pricing takes precedence over enclosed action pricing. A charged event links to its immutable Spark transaction through `sparkTransactionKey`; the transaction links back through `eventKey`.

Event insertion is deliberately non-authoritative for balances. A failed analytics write does not undo completed business work, and balances must never be reconstructed by summing events. Deterministic event keys allow retries after a ledger charge without issuing another charge.

Provider-neutral actions report their slug through `recordActionCost`, and provider usage reports through `addToolTokenUsage`. Priced actions require an authenticated enclosing tool cost context. Unpriced actions can also run outside one without creating a charge.
