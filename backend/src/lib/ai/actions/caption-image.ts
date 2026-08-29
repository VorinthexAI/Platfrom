import { IMAGE_CAPTION_MODEL } from '@/lib/image-caption-constants';
import type { ActionDefinition } from './types';

export const captionImageAction = {
  id: 'caption-image',
  modelPolicy: 'required',
  models: [{ provider: 'google-vertex', model: IMAGE_CAPTION_MODEL, priority: 100 }],
} as const satisfies ActionDefinition;
