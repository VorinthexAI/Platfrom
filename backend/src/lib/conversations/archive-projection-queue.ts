export const conversationArchiveProjectionJobSchema = { parse: (raw: unknown) => raw };
export async function enqueueConversationArchiveProjection(..._args: unknown[]) { return { jobId: 'retired' }; }
export async function processConversationArchiveProjection(..._args: unknown[]) { return { status: 'stale' as const }; }
export function startConversationArchiveProjectionWorker() { return { close: async () => undefined }; }
export async function recoverConversationArchiveProjectionQueue() { return { enqueued: 0 }; }
export async function closeConversationArchiveProjectionQueue() {}
