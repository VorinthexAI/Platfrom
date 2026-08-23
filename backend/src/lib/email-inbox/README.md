# Email Inbox

## Production Gmail Setup Checklist

- Configure and verify the Google OAuth consent screen, including the production domain, privacy policy, requested Gmail scopes, and Google verification where required.
- Enable the Gmail API in the Google Cloud project used by the production OAuth client.
- Create `GMAIL_PUBSUB_TOPIC` and grant `gmail-api-push@system.gserviceaccount.com` the Pub/Sub Publisher role on that topic.
- Create an authenticated push subscription for the topic. Use a dedicated service account and the production email webhook URL, and configure the webhook audience expected by the backend.
- Set `GMAIL_OAUTH_CLIENT_ID` and `GMAIL_OAUTH_CLIENT_SECRET` (or their `GOOGLE_OAUTH_*` fallbacks), `BACKEND_PUBLIC_URL`, `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_PUSH_AUDIENCE`, `GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL`, `GMAIL_PUBSUB_SUBSCRIPTION`, `EMAIL_CONNECTOR_CREDENTIAL_KEYS`, `EMAIL_CONNECTOR_ACTIVE_KEY_ID`, `EMAIL_CONNECTOR_MOBILE_REDIRECT_URIS`, and `REDIS_URL` or `JOB_REDIS_URL` in the encrypted environment registry.
- Run Redis, the email synchronization workers, and the scheduled watch-renewal enqueue process continuously.
- Monitor OAuth failures, webhook authentication, queue depth and retries, sync errors, expiring watches, and token refresh failures. Test connect, initial sync, push sync, watch renewal, send, and disconnect with production-like accounts before launch.

End users only click **Connect Gmail**. They never configure environment variables, Google Cloud resources, Pub/Sub, or workers.

A local disconnect destroys only that connector's encrypted credentials. The platform does not stop Gmail watches or revoke the Google token grant because the same Google account may be bound elsewhere. Users who want to revoke the global Google grant can do so separately in their Google Account security settings.
