import { z } from 'zod';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';
import { getFileInScope } from '@/lib/db/files.node';
import { redisConnection } from '@/lib/redis';
import { generatedFileDeepLinkUrl } from './deep-links';
import { sendExpoPush } from './expo-provider';
import { appNotificationRepository } from './repository';
import { decryptPushToken } from './token-crypto';

export async function sendGeneratedFilePush(fileKey: string, kind: 'image' | 'video' | 'speech', context: ToolContext, dependencies: {
  registeredForUser?: typeof appNotificationRepository.registeredForUser;
  removeUnregistered?: typeof appNotificationRepository.removeUnregistered;
  sendPush?: typeof sendExpoPush;
  decryptToken?: typeof decryptPushToken;
  claim?: (key: string) => Promise<boolean>;
  release?: (key: string) => Promise<void>;
} = {}) {
  const key = z.string().cuid().parse(fileKey);
  const userKey = contextUserKey(context);
  const file = await getFileInScope(context.runtimeScopeKey, key, userKey);
  if (!file || kind === 'video' && file.extension !== 'mp4' || kind === 'speech' && file.extension !== 'mp3' || kind === 'image' && !['jpg', 'jpeg', 'png', 'webp'].includes(file.extension)) throw new Error('The generated file is unavailable in this scope.');
  const subscriptions = await (dependencies.registeredForUser ?? appNotificationRepository.registeredForUser)(userKey);
  if (!subscriptions.length) return { sent: 0, replayed: false };
  const claimKey = `generated-file-push:${userKey}:${key}`;
  const claim = dependencies.claim ?? (async (key: string) => await redisConnection.set(key, 'sending', 'EX', 7 * 24 * 60 * 60, 'NX') === 'OK');
  const release = dependencies.release ?? (async (key: string) => { await redisConnection.del(key); });
  if (!await claim(claimKey)) return { sent: 0, replayed: true };
  try {
    const title = `Your ${kind} generation is finished`;
    const url = generatedFileDeepLinkUrl(key, context.runtimeScopeKey);
    let sent = 0;
    const projects = new Map<string, typeof subscriptions>();
    for (const subscription of subscriptions) projects.set(subscription.projectId, [...(projects.get(subscription.projectId) ?? []), subscription]);
    for (const subscriptionsForProject of projects.values()) for (let index = 0; index < subscriptionsForProject.length; index += 100) {
      const group = subscriptionsForProject.slice(index, index + 100);
      const tickets = await (dependencies.sendPush ?? sendExpoPush)(group.map((subscription) => ({ to: (dependencies.decryptToken ?? decryptPushToken)(subscription.tokenCiphertext), title, body: `Open your generated ${kind} in Storage.`, data: { v: '4', url } })));
      for (let offset = 0; offset < tickets.length; offset += 1) {
        const ticket = tickets[offset]!;
        if (ticket.status === 'ok') sent += 1;
        else if (ticket.details?.error === 'DeviceNotRegistered') await (dependencies.removeUnregistered ?? appNotificationRepository.removeUnregistered)(group[offset]!.key);
      }
    }
    if (!sent) await release(claimKey);
    return { sent, replayed: false };
  } catch (error) {
    await release(claimKey);
    throw error;
  }
}
