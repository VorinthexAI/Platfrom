import { z } from 'zod';

const ticketSchema = z.object({ status: z.enum(['ok', 'error']), id: z.string().optional(), message: z.string().optional(), details: z.object({ error: z.string().optional() }).passthrough().optional() }).passthrough();
const receiptSchema = z.object({ status: z.enum(['ok', 'error']), message: z.string().optional(), details: z.object({ error: z.string().optional() }).passthrough().optional() }).passthrough();
const responseSchema = z.object({ data: z.unknown(), errors: z.unknown().optional() }).passthrough();

function headers() {
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  return { 'Content-Type': 'application/json', Accept: 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
}

async function expoRequest(url: string, body: unknown, fetcher: typeof fetch) {
  const response = await fetcher(url, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const payload = responseSchema.parse(await response.json());
  if (!response.ok || payload.errors) throw new Error(`Expo push service rejected the request (${response.status}).`);
  return payload.data;
}

export async function sendExpoPush(messages: Array<{ to: string; title: string; body: string; data: Record<string, string> }>, fetcher = fetch) {
  const data = await expoRequest('https://exp.host/--/api/v2/push/send', messages.map((message) => ({ ...message, sound: 'default', channelId: 'default', priority: 'high' })), fetcher);
  return z.array(ticketSchema).length(messages.length).parse(data);
}

export async function getExpoPushReceipts(ids: string[], fetcher = fetch) {
  const data = await expoRequest('https://exp.host/--/api/v2/push/getReceipts', { ids }, fetcher);
  return z.record(receiptSchema).parse(data);
}
