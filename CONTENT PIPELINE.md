# Content pipeline

Progress notes for the inventory graph and the first content runs.

## What exists

Two collections, not one per layer:

- `inventoryNodes` holds every card. `kind` is `themes`, `hooks`, `stories`, `scenes`, or `images`.
- `inventoryEdges` holds `satisfies`, `near`, and `produced`.

A run fills one layer. `multiplier` is 1, 2, or 3 cards from that call. Text layers use `plan.primary`. The images layer uses `image.secondary` at 9:16 and low quality, then stores the bytes on `storageKey`. Text is embedded on insert, the same way files are. Close neighbors get a `near` edge so the next run can avoid that pocket.

Each card gets one review: `kept` or `dropped`. A second review is rejected.

## Endpoints

- `POST /pipelines/content/run/stream` streams `start`, `card`, and `done` over SSE. This is the trigger. It is shaped like a chat turn, not a polled job.
- `POST /pipelines/content/review` records the one review for a card.

Body fields: `scopeKey`, `kind`, `multiplier`, optional `brief`, optional `sourceKey`.

## Thoughts

Layers stay independent on purpose. A hook run can cite a theme, but it does not have to generate stories. That is how inventory builds one layer at a time.

The store screen is not a node. It should be attached when a slideshow is assembled, not generated.

The graph is still thin. `near` is cosine similarity at insert time. It is enough to stop the same hook and the same picture from coming straight back. It is not yet a walk that chooses the next lane. That walk should happen before generation, using kept cards and empty pockets, once there are reviews to read.

Do not add a collection when a new layer appears. Add a `kind`, a runner file under `backend/src/lib/ai/pipelines/content`, and the edges that layer is allowed to draw.
