import { describe, expect, test } from 'bun:test';
import { buildUserMentionDocuments } from './repository';

describe('Arango communication repository structure', () => {
  test('never combines same-collection mutation forms in one transaction query', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    const queries = [...source.matchAll(/trx\.query(?:<[^;]+?>)?\(\s*(`[^`]*`|'[^']*')/gs)].map((match) => match[1]!);
    expect(queries.length).toBeGreaterThan(10);
    for (const query of queries) {
      for (const collection of ['channels', 'channelParticipants', 'messageReactions', 'pollVotes']) {
        const mutations = ['INSERT', 'UPDATE', 'REMOVE', 'UPSERT'].filter((operation) => {
          if (!query.includes(operation)) return false;
          return new RegExp(`(?:INTO|IN)\\s+${collection}\\b`).test(query);
        });
        if (mutations.includes('UPSERT')) {
          expect(mutations.filter((operation) => operation !== 'INSERT' && operation !== 'UPDATE')).toEqual(['UPSERT']);
        } else {
          expect(mutations.length).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(source).not.toMatch(/REMOVE old IN pollVotes[\s\S]{0,400}UPSERT/);
    expect(source).not.toMatch(/REMOVE existing IN messageReactions[\s\S]{0,400}INSERT .*messageReactions/);
  });

  test('declares read and write collections for the shared channel, reactions, and votes', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source).toContain("read: ['userOrganizations', 'orchestrators', 'scopes', 'users']");
    expect(source).toContain("write: ['channels', 'channelParticipants']");
    expect(source).toContain("{ read: ['messages', 'channelParticipants'], write: ['messageReactions'] }");
    expect(source).toContain("{ read: ['messages', 'pollOptions'], write: ['polls', 'pollVotes'] }");
  });

  test('projects a stable founder display name', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source.match(/NOT_NULL\(user\.name, user\.alias, user\.email, "Member"\)/g)).toHaveLength(5);
  });

  test('uses one organization-scoped general channel', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source).toContain('UPSERT { organizationKey: @organizationKey, kind: "group", name: "general" }');
    expect(source).toContain("name: 'general'");
    expect(source.match(/POSITION\(@orchestratorNames, orchestrator\.name, true\)/g)).toHaveLength(2);
  });

  test('deduplicates organization members and lists orchestrators independently', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source.match(/COLLECT userKey = memberLink\.userId INTO memberships = memberLink/g)).toHaveLength(2);
    expect(source).toContain('LET agents = (FOR orchestrator IN orchestrators FILTER orchestrator.name IN @orchestratorNames');
    expect(source).not.toContain('FOR participant IN channelParticipants FILTER participant.channelKey == @channelKey && participant.orchestratorKey != null');
    expect(source).not.toMatch(/LET membership = DOCUMENT\([^\n]+\)[\s\S]{0,800}FOR membership IN userOrganizations/);
    expect(source.match(/memberLink\.status == "active"/g)).toHaveLength(2);
    expect(source.match(/memberLink\.userId != (?:@)?viewerUserKey/g)).toHaveLength(2);
  });

  test('omits null optional identifiers from message projections', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source.match(/\.map\(normalizeMessageProjection\)/g)).toHaveLength(3);
  });

  test('persists a new reaction in the validated message scope', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source).toContain('RETURN { scopeKey: message.scopeKey, existingKey:');
    expect(source).toContain('scopeKey: validated.scopeKey');
    expect(source).toContain('`, { channelKey: input.channelKey, messageKey: input.messageKey, participantKey: input.participantKey, reaction: input.reaction });');
    expect(source).not.toContain('`, input);');
    expect(source).not.toContain('scopeKey: newId()');
  });

  test('projects message actions and reply counts consistently and indexes messages off the request path', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source.match(/FOR reaction IN messageReactions FILTER reaction\.messageKey == message\._key/g)).toHaveLength(3);
    expect(source.match(/COLLECT value = reaction\.reaction INTO rows = reaction/g)).toHaveLength(3);
    expect(source.match(/@viewerParticipantKey IN rows\[\*\]\.participantKey/g)).toHaveLength(3);
    expect(source.match(/LET poll = FIRST\(FOR item IN polls FILTER item\.messageKey == message\._key/g)).toHaveLength(3);
    expect(source.match(/replies: \{ count: legacyReplyGroup == null \? LENGTH\(directReplies\) : LENGTH\(legacyReplies\) \}/g)).toHaveLength(2);
    expect(source).toContain('message._key == @parentMessageKey || message.replyToMessageKey == @parentMessageKey');
    expect(source).toContain('message.threadKey == null && message.replyToMessageKey == null');
    expect(source.match(/poll: poll == null \? null : \{ key: poll\._key/g)).toHaveLength(3);
    expect(source).not.toContain('replies: { count: 0 }, poll: null');
    expect(source).toContain('void indexMessage(stored)');
    expect(source).not.toContain('await indexMessage(stored)');
    expect(source).toContain('SORT usage.count DESC, usage.updatedAt DESC, usage.reactionSlug ASC LIMIT @limit');
    expect(source.match(/canEdit: participant\._key == @viewerParticipantKey/g)).toHaveLength(3);
    expect(source.match(/viewerMembership\.orgRole == "owner" \|\| viewerMembership\.orgRole == "admin"/g)).toHaveLength(3);
  });

  test('cascades deletion through replies and restricts editing to the author', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source).toContain('message.replyToMessageKey IN @parentKeys');
    expect(source).toContain('message.threadKey == @threadKey');
    expect(source).toContain('author.userOrganizationKey == @membershipKey || membership.orgRole == "owner" || membership.orgRole == "admin"');
    expect(source).toContain('FILTER author.userOrganizationKey == @membershipKey');
    expect(source).toContain('editedAt: @now, updatedAt: @now');
    expect(source).toContain('current.updatedAt == @updatedAt && current.content == @content');
    expect(source.match(/message\.deletedAt == null/g)?.length).toBeGreaterThanOrEqual(3);
  });

  test('upserts message mentions by their public message key', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source).toContain('UPSERT { messageKey: mention.messageKey, participantKey: mention.participantKey }');
    expect(source).not.toContain('messageKey: mention._key');
  });

  test('generates a distinct usage document for every mentioned orchestrator', () => {
    const documents = buildUserMentionDocuments('user_founder', ['orchestrator_atlas', 'orchestrator_athena'], '2026-07-30T12:00:00.000Z');

    expect(documents.map(({ sourceId }) => sourceId)).toEqual(['orchestrator_atlas', 'orchestrator_athena']);
    expect(new Set(documents.map(({ _key }) => _key)).size).toBe(2);
  });
});
