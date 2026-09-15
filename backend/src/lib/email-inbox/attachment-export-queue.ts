import { Queue, Worker } from 'bullmq';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { createRedisConnection } from '@/lib/redis';
import { createEmailAttachmentIngestionService } from './attachment-ingestion';

const queueName = 'email-attachment-exports';
export const attachmentExportJobSchema = z.object({ attachmentKey: z.string().cuid() }).strict();
type ExportJob = z.infer<typeof attachmentExportJobSchema>;

export async function recoverAttachmentExports(queue: Pick<Queue<ExportJob>, 'add'>, database: Pick<typeof db, 'query'> = db) {
  // The pending flag is written with canonical storage. Redis outages/restarts
  // cannot lose an export, and completed user-owned copies are not recreated.
  const cursor = await database.query('FOR attachment IN emailAttachments FILTER attachment.status == "completed" && attachment.exportPending == true LET connector = DOCUMENT(userConnectors, attachment.connectorKey) FILTER connector != null && connector.status != "revoked" && connector.syncEnabled != false SORT attachment._key RETURN attachment._key');
  for (const attachmentKey of await cursor.all()) {
    const job = attachmentExportJobSchema.parse({ attachmentKey });
    await queue.add('export', job, { jobId: job.attachmentKey, attempts: 8, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: true });
  }
}

export function startAttachmentExportWorker() {
  const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
  const queue = new Queue<ExportJob>(queueName, { connection: connection() });
  const service = createEmailAttachmentIngestionService();
  const worker = new Worker<ExportJob>(queueName, (job) => service.retryExport(attachmentExportJobSchema.parse(job.data).attachmentKey), { connection: connection(), concurrency: 2 });
  queue.on('error', (error) => console.error('email attachment export queue error', error));
  worker.on('error', (error) => console.error('email attachment export worker error', error));
  let recovery: Promise<void> | undefined;
  const recover = () => {
    if (!recovery) recovery = recoverAttachmentExports(queue).catch((error) => console.error('email attachment export recovery failed', error)).finally(() => { recovery = undefined; });
  };
  recover();
  const timer = setInterval(recover, 60_000);
  return { async close() { clearInterval(timer); await recovery; await worker.close(); await queue.close(); } };
}
