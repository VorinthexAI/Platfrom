import { IMAGE_CAPTION_MODEL } from '@/lib/image-caption-constants';
import type { ActionDefinition } from './types';

export const documentCleanupAction: ActionDefinition = {
  id: 'document-cleanup',
  modelPolicy: 'required',
  models: [{ provider: 'openai', model: IMAGE_CAPTION_MODEL, priority: 100 }],
};
