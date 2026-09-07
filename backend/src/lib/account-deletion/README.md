# Account deletion safety

Deletion uses a durable `users.deletionRequestedAt` fence before external work.
Presence and checkout creation reject fenced users. Provider subscription
reconciliation/revocation and Redis tombstoning run only after the short fence
transaction has committed and while no Arango transaction is open. One final
exclusive Arango transaction revalidates the fence and deletion invariants and
atomically removes all owned data. A provider or Redis failure leaves the fence
in place so an authenticated retry can safely continue without allowing new
charges or authenticated presence sessions.

Session-bound access tokens are intentionally invalid after the final teardown
removes their `authSessions` row. Therefore an HTTP response lost after commit
cannot be replayed as an authenticated request and will receive a Bearer `401`
from auth middleware. Treating an unauthenticated request as a successful delete
would weaken authentication, so this is an accepted transport limitation. The
mobile API client already clears its token vault and notifies auth state on a
Bearer `401`, which produces the same signed-out outcome as a received success.
