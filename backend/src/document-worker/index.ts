import { runDocumentProcessingWorker } from '@/lib/ai/document-processing/fargate-queue';

try {
  await runDocumentProcessingWorker();
  process.exit(0);
} catch (error) {
  console.error(JSON.stringify({ action: 'document.worker', status: 'failed', error: error instanceof Error ? error.message : 'unknown error' }));
  process.exit(1);
}
