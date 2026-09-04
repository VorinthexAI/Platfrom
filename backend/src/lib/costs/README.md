# Spark costs

Sparks are displayed to people; accounting and persistence use integer microSparks. One Spark is exactly 1,000,000 microSparks. Floating-point values never enter the ledger. Decimal display values are parsed to microSparks, and fractional calculated costs are rounded up only at the final charge boundary.

Every account receives one idempotent grant of exactly 100 Sparks (100,000,000 microSparks). Repeating account setup replays that transaction rather than issuing another grant.

Every public tool has one explicit billing policy: fixed, action-metered, or free. Tool prices represent user-facing capability prices. Action prices represent direct AI work when no enclosing tool price applies. Tool pricing takes precedence over action pricing, so a tool and the AI action it invokes are never both charged. Fixed-price book creation and extension charge for durable queue acceptance; other fixed tools charge for successful operation completion.

AI usage is metered from trusted invocation data immediately after provider results are known. Each successful action receives its own idempotent charge using a stable identity that excludes variable usage totals; usage and the calculated amount are stored as transaction metadata. Fixed tools are debited before work starts and refunded in full when their operation fails. Every authenticated priced execution requires a stable request key before tool work or provider work starts; unsafe calls are rejected instead of receiving a random key. Retries must reuse that key. Provider telemetry and operational events may explain a charge, but they are not balances and must not be summed as a ledger.

Storage is priced at exactly 24 Sparks per GiB-month, using 1 GiB = 1,073,741,824 bytes and a 730-hour billing month. The hourly automation measures exact half-open object lifetimes as integer byte-milliseconds. Any fractional microSpark remainder is carried into the next hour for that user, so hourly boundaries do not lose or invent usage through repeated rounding.

Spark transactions are the immutable financial record. Each transaction stores its signed delta and resulting user balance. A debit or negative adjustment that would take the balance below zero is rejected atomically; Spark accounts never provide implicit credit. Events describe product activity and can be retried, reordered, or retained differently; they must never be treated as the source of truth for a balance. An event may reference a ledger transaction, but emitting an event does not itself charge or grant Sparks.
