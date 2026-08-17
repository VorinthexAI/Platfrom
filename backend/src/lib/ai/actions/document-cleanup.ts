import { IMAGE_CAPTION_MODEL } from '@/lib/image-caption-constants';
import type { ActionDefinition } from './types';

export const documentCleanupAction: ActionDefinition = {
  id: 'document-cleanup',
  modelPolicy: 'required',
  models: [{ provider: 'openrouter', model: IMAGE_CAPTION_MODEL, priority: 100 }],
};
