# Email Inbox

## Production Provider Setup Checklist

- Configure and verify the Google OAuth consent screen, including the production domain, privacy policy, requested Gmail scopes, and Google verification where required.
- Enable the Gmail API in the Google Cloud project used by the production OAuth client.
- Create `GMAIL_PUBSUB_TOPIC` and grant `gmail-api-push@system.gserviceaccount.com` the Pub/Sub Publisher role on that topic.
- Create an authenticated push subscription for the topic. Use a dedicated service account and the production email webhook URL, and configure the webhook audience expected by the backend.
- Register a Microsoft Entra application with the Outlook delegated permissions `User.Read`, `Mail.ReadWrite`, and `Mail.Send`. Add `https://<backend>/api/v1/email/connectors/outlook/callback` as a web redirect URI.
- Set `GMAIL_OAUTH_CLIENT_ID` and `GMAIL_OAUTH_CLIENT_SECRET` (or their `GOOGLE_OAUTH_*` fallbacks), `OUTLOOK_OAUTH_CLIENT_ID`, `OUTLOOK_OAUTH_CLIENT_SECRET`, optional `OUTLOOK_OAUTH_TENANT` and `OUTLOOK_OAUTH_REDIRECT_URI`, `BACKEND_PUBLIC_URL`, `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_PUSH_AUDIENCE`, `GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL`, `GMAIL_PUBSUB_SUBSCRIPTION`, `EMAIL_CONNECTOR_CREDENTIAL_KEYS`, `EMAIL_CONNECTOR_ACTIVE_KEY_ID`, `EMAIL_CONNECTOR_MOBILE_REDIRECT_URIS`, and `REDIS_URL` or `JOB_REDIS_URL` in the encrypted environment registry.
- iCloud users enter their Apple ID email and an app-specific password. The backend validates it against `imap.mail.me.com`, stores it only in the encrypted connector envelope, reads over IMAPS, and sends over TLS-protected SMTP.
- Run Redis, the email synchronization workers, Gmail watch renewal, and Outlook/iCloud polling continuously.
- Monitor OAuth failures, webhook authentication, queue depth and retries, sync errors, expiring watches, and token refresh failures. Test connect, initial sync, push sync, watch renewal, send, and disconnect with production-like accounts before launch.

End users choose Gmail, Outlook, or Apple iCloud. They never configure cloud resources or workers; only iCloud asks the user for an app-specific password.

A local disconnect destroys only that connector's encrypted credentials. The platform does not stop Gmail watches or revoke the Google token grant because the same Google account may be bound elsewhere. Users who want to revoke the global Google grant can do so separately in their Google Account security settings.
