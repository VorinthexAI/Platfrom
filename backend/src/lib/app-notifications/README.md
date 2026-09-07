# Expo Push Notifications

`app.notify` creates notifications and `notification.list` reads the current
user's history. Their HTTP adapters and Core tools call the same service.
Device token registration is an authenticated protocol boundary and never
accepts a user key from the client.

## Production Setup

1. Set `EXPO_PUSH_TOKEN_ENCRYPTION_KEY` to a base64-encoded 32-byte random key.
2. Enable enhanced push security in Expo and set the backend-only
   `EXPO_ACCESS_TOKEN`. Never expose either value as `EXPO_PUBLIC_*`.
3. Configure Android FCM v1 and iOS APNs credentials for EAS project
   `2a9ba74e-cefe-49e6-9fd0-9b38a69c8d18` with `eas credentials`.
4. Rebuild the native app after notification credential or icon changes.
5. Run the Arango migration before starting the API. Normal deployment already
   does this and injects backend environment values through SSM.

Generate the encryption key with:

```bash
openssl rand -base64 32
```

Official references:

- https://docs.expo.dev/push-notifications/push-notifications-setup/
- https://docs.expo.dev/push-notifications/sending-notifications/
- https://docs.expo.dev/push-notifications/fcm-credentials/

## Contracts

- `PUT /api/v1/auth/me/push-subscription` registers the authenticated
  installation. The user key and installation identifier are trusted context.
- `DELETE /api/v1/auth/me/push-subscription` removes that installation.
- `POST /api/v1/auth/me/notifications` lists the authenticated user's durable
  team history. `markRead: true` atomically clears its unread state.
- `POST /api/v1/app/notify` requires `Idempotency-Key`, `teamKey`, and
  `scopeKey`, then accepts the same strict model input as `app.notify`.
- Use `userKeys` for explicit recipients or `notifyAll: true`, never both.
- `notifyAll` means every active user authorized for the current team
  and scope, not every platform user.
- Viewers may notify only themselves. Moderator or stronger access is required
  to notify another user or use `notifyAll`.

One history projection per recipient is persisted even when the user has no
registered device. Delivery is at least once because Expo has no send
idempotency key. Logical requests and per-device deliveries are persisted
before queueing. At dispatch time, the worker suppresses device delivery for
users with a live multi-device presence lease while retaining their history.
It chunks sends to 100, limits throughput to 600 per second, retries transient
failures, checks receipts after 15 minutes, and removes only the exact token
reported as `DeviceNotRegistered`. A successful receipt means APNs or FCM
accepted the message; it does not prove that the user saw it.

The daily storage-retention automation calls the notification service directly.
It atomically fences one low-Sparks warning per rolling 24 hours and retention
lifecycle, persists history before queueing any Expo delivery, and does not warn
once funding or wiping takes precedence. Notification embeddings use the title,
a blank line, and the message.
