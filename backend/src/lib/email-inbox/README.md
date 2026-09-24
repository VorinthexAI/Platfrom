# Email Inbox

## Production Provider Setup Checklist

- Configure and verify the Google OAuth consent screen, including the production domain, privacy policy, requested Gmail scopes, and Google verification where required.
- Enable the Gmail API in the Google Cloud project used by the production OAuth client. OAuth consent can succeed even when that API is disabled; the first Gmail profile request will then return HTTP 403 and the app cannot finish connecting.
- Create `GMAIL_PUBSUB_TOPIC` and grant `gmail-api-push@system.gserviceaccount.com` the Pub/Sub Publisher role on that topic.
- Create an authenticated push subscription for the topic. Use a dedicated service account and the production email webhook URL, and configure the webhook audience expected by the backend.
- Set `GMAIL_OAUTH_CLIENT_ID` and `GMAIL_OAUTH_CLIENT_SECRET` (or their `GOOGLE_OAUTH_*` fallbacks), `BACKEND_PUBLIC_URL`, `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_PUSH_AUDIENCE`, `GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL`, `GMAIL_PUBSUB_SUBSCRIPTION`, `EMAIL_CONNECTOR_CREDENTIAL_KEYS`, `EMAIL_CONNECTOR_ACTIVE_KEY_ID`, `EMAIL_CONNECTOR_MOBILE_REDIRECT_URIS`, and `REDIS_URL` or `JOB_REDIS_URL` in the encrypted environment registry.
- Run Redis, the email synchronization workers, and Gmail watch renewal continuously.
- Monitor OAuth failures, webhook authentication, queue depth and retries, sync errors, expiring watches, and token refresh failures. Test connect, initial sync, push sync, watch renewal, send, and disconnect with production-like accounts before launch.

Signal email connectors support Gmail only. End users authorize Gmail through Google OAuth and never configure cloud resources or workers.

### OAuth scope verification and callback compatibility

The current authorization request uses `openid`, `email` (the Google
`https://www.googleapis.com/auth/userinfo.email` alias), and
`https://mail.google.com/`. Declare these on **Google Auth Platform → Data Access**
in the project that owns the configured OAuth client. **In production** is a
publishing setting, not approval of the restricted Gmail scope. Complete Branding
and submit the Gmail data-access verification with a working end-to-end demo.
Server-side storage/processing of restricted Gmail data is subject to Google's
applicable security-assessment requirements. Project submission, domain ownership,
and the reviewer demo must be completed by the project owner; deployment alone
cannot mark the Google application verified.

The full Gmail scope remains intentional: **Clear Trash** uses
`messages.batchDelete` for permanent deletion. Both Trash features and the scope
remain enabled. A demo should show consent in English, inbox import/read/search,
read/star changes, a user-approved send, Trash/Clear Trash on test mail, and
disconnect. See https://developers.google.com/workspace/gmail/api/auth/scopes.

Google may include `iss=https://accounts.google.com` in the authorization response.
The shared strict transport schemas in `src/api/oauth-callback-schemas.ts` validate
it on both the dedicated Gmail callback and the shared Google sign-in callback.
Unknown fields and other issuers remain rejected. Existing one-time state, PKCE,
nonce, and token identity checks still apply.

Connection failures log a fixed stage (`token-exchange`, `gmail-profile`,
`connector-persistence`, `inbox-initialization`, `sync-initialization`,
`gmail-watch`, `initial-sync-enqueue`, or `connection-grant`) and numeric
provider/database codes when available. These diagnostics deliberately exclude
authorization codes, state tokens, credentials, email addresses, and provider
response bodies. Recognized disabled-API and missing-scope errors return safe,
specific mobile messages without exposing provider payloads. Retry connection
with a fresh OAuth flow after the API is enabled or a deployment;
authorization state and grants are one-time and short-lived.

Manual synchronization and Gmail subscription notifications are independent ingestion entry points. Both converge on the same provider-thread parser, pass every message through the canonical inbox sorter, and persist private `emailInboxes`, `emailThreads`, `emailMessages`, `emailDrafts`, `emailTones`, `emailReplyContext`, `emailWritingProfiles`, and `emailAttachments` rows. Archive and Gallery receive ordinary user-owned exports only; they are not Signal's lifecycle source. Subscription workers must call the system-only `ingestSubscriptionNotification`, never `sync`; that canonical operation owns exact-connector authorization and durable pending-history marking/clearing.

After a subscription-origin `messagesAdded` thread has been sorted and committed, the system-only `email.draft.create-if-needed` capability makes one best-effort structured decision: it either skips the message or persists an idempotent reply draft keyed to that source message. Draft-generation failures are reported but do not roll back committed ingestion or prevent cursor advancement. Added-message provenance is persisted across subscription continuations. Initial/manual sync, label-only changes, deletions, and `inbox.sort` never create automatic drafts. Draft provenance is server-controlled; Drafts listing and search expose subscription-created drafts while manual reply/new-message drafts remain addressable through their direct lifecycle operations.

Supported PDF, TXT, Markdown, DOC, and DOCX attachments use Archive's parser, while images use Gallery processing. Canonical bytes and ownership remain in `emailAttachments`; any Archive document or Gallery image is an ordinary export copy created just in time. Both attachment paths run from the shared provider-thread parser, so manual synchronization and subscription notifications behave identically.

PDF exports use the same model-based document transcription as direct uploads;
the parser receives the trusted connector team context and no longer uses AWS OCR.

Permanent provider attachment errors are isolated per MIME part and exposed as unavailable attachment counts; transient errors retry ingestion. Export intent is persisted with canonical attachment storage (`exportPending`). The attachment export worker recovers pending exports every minute, retries independently of mailbox cursors, and acknowledges them only after persistence and refresh publication. Acknowledged exports are not recreated on ordinary replay.

Draft attachment selectors accept private email attachment keys owned by the user or Archive/Gallery asset keys in the authorized destination scope. Original stored bytes and MIME types are used for sending; text-only Archive documents are sent as UTF-8 text files. Sent workspace selections are re-ingested from Gmail into independent canonical email attachments. Thread reads project canonical attachment keys to their separate Archive/Gallery export keys for the shipped attachment viewer; stored message references remain canonical.

Automatic drafts resolve tones, reply context, sender identity, and persistence ownership from the connector owner, never the system execution principal. Sent-only and archived threads skip the inbox-only automatic draft precheck. Inbox visibility and categories use inbox labels, while the conversation preview and action state include newer sent/archived replies (excluding spam, trash, and provider drafts).

Disconnect hard-deletes that inbox's local mailbox rows (threads, messages, drafts, email attachments, inbox metadata, and the connector document) and destroys its encrypted credentials. Archive and Gallery export copies stay. If no other active Vorinthex connector shares that Gmail address, disconnect also stops the Gmail watch and revokes the Google OAuth grant.

Migration backfills reuse the storage key already referenced by an Archive or Gallery export; they do not copy physical objects. Legacy Compass hero rows therefore derive a deterministic migration hash from that storage key when the historical Gallery row has no byte hash. A later rewrite creates independently owned canonical objects during normal regeneration.
