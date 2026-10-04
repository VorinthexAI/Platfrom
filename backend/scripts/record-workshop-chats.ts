import { closeDb } from '@/lib/db/client';
import { memberPrincipal, type ToolContext } from '@/lib/ai/tools/tool-context';
import { scopeService } from '@/lib/ai/scopes/service';
import { getDefaultConversationRepository } from '@/lib/conversations/repository';
import { conversationSchema } from '@/lib/conversations/schemas';
import { getDefaultConversationService, type ConversationTurnEvent } from '@/lib/conversations/service';
import { redisConnection } from '@/lib/redis';
import { targetDevUser } from './dev/files-environment';
import { captureWorkshopRetrievals, workshopChatArchivePath, workshopChatArchiveSchema, workshopChatKey } from './dev/workshop-chat-fixtures';
import { workshopChatPlans } from './dev/workshop-chats';
import { WORKSHOP_SCOPE_MARKER } from './dev/workshop-year';

async function main() {
  const user = await targetDevUser(process.argv.slice(2));
  const base: ToolContext = { userKey: user.key, teamKey: user.key, runtimeScopeKey: user.currentScopeKey, principal: memberPrincipal(user) };
  const scope = (await scopeService.list(base)).scopes.find(({ slug }) => slug === 'the-workshop-year');
  if (!scope || scope.description !== WORKSHOP_SCOPE_MARKER) throw new Error('Seed the local Workshop Year scope before recording its chats.');
  const context = { ...base, runtimeScopeKey: scope.key };
  const owner = { userKey: user.key, teamKey: user.key, scopeKey: scope.key };
  const repository = getDefaultConversationRepository();
  const service = getDefaultConversationService();
  const chats = [];
  for (const plan of workshopChatPlans) {
    const conversationKey = workshopChatKey(user.key, scope.key, plan.slug);
    if (!await repository.read(owner, conversationKey)) {
      const at = new Date().toISOString();
      await repository.create(conversationSchema.parse({ key: conversationKey, ...owner, name: plan.title, isFavorite: false, isHidden: false, roleKey: 'general', createdAt: at, updatedAt: at }), user.key);
    }
    const turns = [];
    for (const [index, message] of plan.messages.entries()) {
      let done: Extract<ConversationTurnEvent, { type: 'done' }> | undefined;
      await service.turn({ conversationKey, message, requestKey: `dev:workshop-chat:${plan.slug}:${index}` }, context, (event) => {
        if (event.type === 'done') done = event;
      });
      if (!done || done.message.status !== 'COMPLETED') throw new Error(`Core did not complete ${plan.slug} turn ${index + 1}.`);
      turns.push({ user: message, assistant: done.message.content, retrievals: await captureWorkshopRetrievals(done.message.retrievals, context) });
      console.log(`${plan.title}: ${index + 1}/${plan.messages.length} turns (${done.message.retrievals.length} file reads)`);
    }
    chats.push({ slug: plan.slug, title: plan.title, turns });
  }
  const archive = workshopChatArchiveSchema.parse({ version: 1, chats });
  await Bun.write(workshopChatArchivePath, `${JSON.stringify(archive, null, 2)}\n`);
  console.log(`Recorded ${archive.chats.length} chats to ${workshopChatArchivePath}.`);
}

if (import.meta.main) {
  try { await main(); }
  catch (error) { console.error(error); process.exitCode = 1; }
  finally { redisConnection.disconnect(); await closeDb(); }
  process.exit(process.exitCode ?? 0);
}
