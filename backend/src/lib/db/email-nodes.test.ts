import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '../embeddings';
import { buildEmbeddingText } from './base';
import { emailAccountSchema } from './email-accounts.node';
import { emailContactSchema, emailContactsEmbeddingFields } from './email-contacts.node';
import { emailMessageSchema, emailMessagesEmbeddingFields } from './email-messages.node';
import { emailReplyDraftSchema, emailReplyDraftsEmbeddingFields } from './email-reply-drafts.node';
import { emailRuleSchema, emailRulesEmbeddingFields } from './email-rules.node';
import { emailThreadSchema, emailThreadsEmbeddingFields } from './email-threads.node';
import { emailWritingProfileSchema, emailWritingProfilesEmbeddingFields } from './email-writing-profiles.node';

const key = 'cmrnlzf650002qc7k4p5zem5w';
const otherKey = 'cmrnlzf640001qc7kazsr96k5';
const now = '2026-08-08T12:00:00.000Z';
const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

describe('email node contracts', () => {
  test('requires exact 4096-dimensional vectors only on semantic records', () => {
    expect(EMBEDDING_DIMENSIONS).toBe(4096);
    for (const schema of [emailThreadSchema, emailMessageSchema, emailContactSchema, emailWritingProfileSchema, emailRuleSchema, emailReplyDraftSchema]) {
      const object = 'innerType' in schema ? schema.innerType() : schema;
      expect(object.shape.embedding.safeParse(embedding).success).toBe(true);
      expect(object.shape.embedding.safeParse(embedding.slice(1)).success).toBe(false);
    }
    expect(emailAccountSchema.shape).not.toHaveProperty('embedding');
  });

  test('defines exact semantic field ordering', () => {
    expect(emailThreadsEmbeddingFields).toEqual(['subject', 'summary', 'intent', 'action']);
    expect(emailMessagesEmbeddingFields).toEqual(['subject', 'body', 'summary']);
    expect(emailContactsEmbeddingFields).toEqual(['name', 'relationship', 'context']);
    expect(emailWritingProfilesEmbeddingFields).toEqual(['name', 'description', 'tone', 'style', 'structure', 'vocabulary', 'conventions']);
    expect(emailRulesEmbeddingFields).toEqual(['name', 'description', 'condition', 'instruction']);
    expect(emailReplyDraftsEmbeddingFields).toEqual(['generatedContent', 'finalContent']);
    expect(buildEmbeddingText(emailThreadsEmbeddingFields, { subject: 'Plan', summary: 'Short', intent: 'Reply', action: 'Confirm' })).toBe('Plan\n\nShort\n\nReply\n\nConfirm');
  });

  test('validates account, thread, message, rule, and draft enums', () => {
    expect(emailAccountSchema.safeParse({ key, scopeKey: otherKey, provider: 'gmail', providerAccountId: 'account-1', email: 'person@example.com', syncEnabled: true, createdAt: now, updatedAt: now }).success).toBe(true);
    expect(emailAccountSchema.safeParse({ key, scopeKey: otherKey, provider: 'outlook', providerAccountId: 'account-1', email: 'person@example.com', syncEnabled: true, createdAt: now, updatedAt: now }).success).toBe(false);
    const thread = { key, scopeKey: otherKey, accountKey: key, providerThreadId: 'thread-1', subject: 'Subject', summary: 'Summary', intent: 'Respond', priority: 'urgent', state: 'needs_action', lastMessageAt: now, embedding, deletedAt: null, createdAt: now, updatedAt: now };
    expect(emailThreadSchema.safeParse(thread).success).toBe(true);
    expect(emailThreadSchema.safeParse({ ...thread, state: 'open' }).success).toBe(false);
    const message = { key, scopeKey: otherKey, accountKey: key, threadKey: otherKey, providerMessageId: 'message-1', from: 'from@example.com', to: ['to@example.com'], subject: 'Subject', body: 'Body', summary: 'Summary', direction: 'inbound', sentAt: now, hasAttachments: false, embedding, createdAt: now, updatedAt: now };
    expect(emailMessageSchema.safeParse(message).success).toBe(true);
    expect(emailRuleSchema.safeParse({ key, scopeKey: otherKey, name: 'Important', description: 'Prioritize important mail', condition: 'From leadership', instruction: 'Raise priority', action: 'prioritize', config: {}, isEnabled: true, embedding, createdAt: now, updatedAt: now }).success).toBe(true);
    expect(emailReplyDraftSchema.safeParse({ key, scopeKey: otherKey, threadKey: key, messageKey: otherKey, generatedContent: 'Thanks', status: 'generated', embedding, createdAt: now, updatedAt: now }).success).toBe(true);
    expect(emailContactSchema.safeParse({ key, scopeKey: otherKey, email: 'person@example.com', embedding, createdAt: now, updatedAt: now }).success).toBe(false);
    expect(emailContactSchema.safeParse({ key, scopeKey: otherKey, email: 'person@example.com', name: 'Person', embedding, createdAt: now, updatedAt: now }).success).toBe(true);
  });
});
