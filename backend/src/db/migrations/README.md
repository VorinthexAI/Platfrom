# Graph migrations

Add one thin, immutable file per schema or data change and register it in `index.ts`.

- Use the next zero-padded ID, such as `0002-add-example-index`.
- Keep migrations idempotent because a process can fail after `up` succeeds but before its ledger row is written.
- Never edit an applied migration. Source-derived checksums make deployed edits fail closed; add a new migration instead.
- Include any helper file that owns migration behavior in the migration's checksum file list.

`migration-runner.ts` records successful entries in `schemaMigrations` and runs only entries that have not been applied.
Failed attempts remain in the ledger and are reclaimed by the same migration ID. A renewable claim prevents concurrent runners from applying the same migration.
