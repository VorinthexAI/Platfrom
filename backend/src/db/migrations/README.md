# Graph migrations

Add one thin, immutable file per schema or data change and register it in `index.ts`.

**Never edit an existing migration file.** Checksums fail closed, so rewriting an applied migration breaks `bun start` on existing databases and deployed environments. Do not treat a local wipe as the migration path.

For any schema or seed change:

1. Add a new numbered file (next zero-padded ID, such as `0019-rename-hq-summary`) and register it in `index.ts`.
2. Make `up` backwards compatible with databases that already applied earlier migrations.
3. Backfill existing documents, indexes, and collections. Fresh installs are not enough.
4. Keep `up` idempotent: a process can fail after `up` succeeds but before its ledger row is written.

Platform seed data (Founders team, Vorinthex AI / Core / HQ / Archive / Gallery / Signal / Compass / Ascend scopes, commerce products, and removal of unused seeded scopes and orchestrators) lives in `0018-canonical-seed.ts`. The runner stores that file's checksum in `schemaMigrations` and skips it after it is applied. Do not add a separate `db:seed` path. To change seed data, add another migration that updates or backfills rows.

Do not fold later schema into `0001-legacy-schema` or `arango-migrate.ts` instead of a new migration. `0001` checksums `arango-migrate.ts`, so editing that file looks like an applied migration was rewritten.

Include any helper file that owns migration behavior in the migration's checksum file list.

`migration-runner.ts` records successful entries in `schemaMigrations` and runs only entries that have not been applied.
Failed attempts remain in the ledger and are reclaimed by the same migration ID. A renewable claim prevents concurrent runners from applying the same migration.
