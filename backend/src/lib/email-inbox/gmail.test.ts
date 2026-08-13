import { describe, expect, test } from 'bun:test';
import { deterministicEmailClassification } from './classification';
import { buildGmailAuthorizationUrl, createGmailClient, emailAddresses, messageBodies } from './gmail';

describe('Gmail connector protocol', () => {
  test('builds offline PKCE consent without changing login scopes', () => {
    const url = new URL(buildGmailAuthorizationUrl({ state: 'state', nonce: 'nonce', codeChallenge: 'challenge' }, { GOOGLE_OAUTH_CLIENT_ID: 'client', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', BACKEND_PUBLIC_URL: 'https://api.example.com' }));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('gmail.modify');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.com/api/v1/auth/mobile/oauth/google/callback');
  });

  test('parses display-name addresses and nested MIME bodies', () => {
    expect(emailAddresses('"Person, One" <one@example.com>, two@example.com')).toEqual(['one@example.com', 'two@example.com']);
    expect(messageBodies({ mimeType: 'multipart/mixed', parts: [
      { mimeType: 'text/plain', body: { data: Buffer.from('Hello').toString('base64url') } },
      { mimeType: 'application/pdf', filename: 'brief.pdf' },
    ] })).toEqual({ text: 'Hello', hasAttachments: true, html: undefined });
  });

  test('classifies provider labels and urgent subjects deterministically', () => {
    expect(deterministicEmailClassification({ labels: ['CATEGORY_PROMOTIONS'], subject: 'Sale', from: 'shop@example.com', direction: 'inbound' })).toMatchObject({ priority: 'low', state: 'filtered', category: 'promotions' });
    expect(deterministicEmailClassification({ labels: ['INBOX'], subject: 'Urgent: review today', from: 'lead@example.com', direction: 'inbound' })).toMatchObject({ priority: 'urgent', state: 'needs_action' });
  });

  test('requests paginated inbox and incremental history without exposing tokens in URLs', async () => {
    const requests: string[] = [];
    const bodies: unknown[] = [];
    const client = createGmailClient('private-access-token', (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(String(input));
      bodies.push(init?.body);
      return Response.json({ threads: [], history: [] });
    }) as typeof fetch);
    await client.listThreads(100, 'next-page');
    await client.history('history-1', 'history-page');
    await client.threadMetadata('thread-1');
    await client.message('message-1');
    await client.watch('projects/project/topics/gmail');
    await client.revoke();
    expect(requests[0]).toContain('includeSpamTrash=true');
    expect(requests[0]).toContain('pageToken=next-page');
    expect(requests[1]).toContain('startHistoryId=history-1');
    expect(requests.join(' ')).not.toContain('private-access-token');
    expect(requests[2]).toContain('/threads/thread-1?format=minimal');
    expect(requests[3]).toContain('/messages/message-1?format=full');
    expect(bodies[4]).toBe(JSON.stringify({ topicName: 'projects/project/topics/gmail' }));
    expect(bodies[5]).toBe('token=private-access-token');
  });
});
