import { runImageHashWorker } from '@/lib/ai/image-processing/perceptual-hash-queue';

try {
  await runImageHashWorker();
} catch (error) {
  console.error('Image hash worker failed.', error);
  process.exitCode = 1;
}
