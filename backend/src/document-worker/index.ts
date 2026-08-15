import { runDocumentProcessingWorker } from '@/lib/ai/document-processing/fargate-queue';

try {
  await runDocumentProcessingWorker();
} catch (error) {
  console.error(JSON.stringify({ action: 'document.queue.worker', status: 'failed', error: error instanceof Error ? error.message : 'unknown error' }));
  process.exitCode = 1;
}
