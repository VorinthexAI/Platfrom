# Email Inbox

## Production Provider Setup Checklist

- Configure and verify the Google OAuth consent screen, including the production domain, privacy policy, requested Gmail scopes, and Google verification where required.
- Enable the Gmail API in the Google Cloud project used by the production OAuth client.
- Create `GMAIL_PUBSUB_TOPIC` and grant `gmail-api-push@system.gserviceaccount.com` the Pub/Sub Publisher role on that topic.
- Create an authenticated push subscription for the topic. Use a dedicated service account and the production email webhook URL, and configure the webhook audience expected by the backend.
- Set `GMAIL_OAUTH_CLIENT_ID` and `GMAIL_OAUTH_CLIENT_SECRET` (or their `GOOGLE_OAUTH_*` fallbacks), `BACKEND_PUBLIC_URL`, `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_PUSH_AUDIENCE`, `GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL`, `GMAIL_PUBSUB_SUBSCRIPTION`, `EMAIL_CONNECTOR_CREDENTIAL_KEYS`, `EMAIL_CONNECTOR_ACTIVE_KEY_ID`, `EMAIL_CONNECTOR_MOBILE_REDIRECT_URIS`, and `REDIS_URL` or `JOB_REDIS_URL` in the encrypted environment registry.
- Run Redis, the email synchronization workers, and Gmail watch renewal continuously.
- Monitor OAuth failures, webhook authentication, queue depth and retries, sync errors, expiring watches, and token refresh failures. Test connect, initial sync, push sync, watch renewal, send, and disconnect with production-like accounts before launch.

Signal email connectors support Gmail only. End users authorize Gmail through Google OAuth and never configure cloud resources or workers.

Manual synchronization and Gmail subscription notifications are independent ingestion entry points. Both converge on the same provider-thread parser, pass every message through the canonical inbox sorter, and use Archive's canonical representation preparation before the email transaction persists managed thread and message documents. Subscription workers must call the system-only `ingestSubscriptionNotification`, never `sync`; that canonical operation owns exact-connector authorization and durable pending-history marking/clearing.

After a subscription-origin `messagesAdded` thread has been sorted and committed, the system-only `email.draft.create-if-needed` capability makes one best-effort structured decision: it either skips the message or persists an idempotent reply draft keyed to that source message. Draft-generation failures are reported but do not roll back committed ingestion or prevent cursor advancement. Added-message provenance is persisted across subscription continuations. Initial/manual sync, label-only changes, deletions, and `inbox.sort` never create automatic drafts. Draft provenance is server-controlled; Drafts listing and search expose subscription-created drafts while manual reply/new-message drafts remain addressable through their direct lifecycle operations.

Supported PDF, TXT, Markdown, DOC, and DOCX attachments are extracted through Archive's canonical document parser into `Signal/Inboxes/<Inbox>/Files`. Image attachments are processed through Gallery and stored in the protected Signal collection. Both attachment paths run from the shared provider-thread parser, so manual synchronization and subscription notifications behave identically.

Disconnect blocks new local work and destroys that connector's encrypted credentials. It intentionally does not stop the account-wide Gmail watch or revoke the account-wide Google OAuth grant because another authorized Vorinthex connector may share them; notifications for the disconnected connector are ignored and its watch expires naturally.
