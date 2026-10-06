# Account deletion safety

Deletion uses a durable `users.deletionRequestedAt` fence before external work.
Presence rejects fenced users. Redis session invalidation runs after the short
fence transaction has committed and while no Arango transaction is open. One
final exclusive Arango transaction revalidates the fence and atomically removes
all owned data. A Redis failure leaves the fence in place for an authenticated
retry. App store subscriptions are managed in the store; the app tells the user
to cancel a subscription before deleting their account.

The final transaction follows the current `user → scopes → folders → files`
model. It removes user-owned documents and dependent chat, tag, ticket,
notification, auth, referral, and billing records, while
queuing stored bytes through the fenced deletion outbox. It never requires
retired team or scope-membership collections.
The installation's consumed newcomer-grant claim remains with its user link
removed, preventing repeat grants after account deletion on the same device.

Session-bound access tokens are intentionally invalid after the final teardown
removes their `authSessions` row. Therefore an HTTP response lost after commit
cannot be replayed as an authenticated request and will receive a Bearer `401`
from auth middleware. Treating an unauthenticated request as a successful delete
would weaken authentication, so this is an accepted transport limitation. The
mobile API client already clears its token vault and notifies auth state on a
Bearer `401`, which produces the same signed-out outcome as a received success.
