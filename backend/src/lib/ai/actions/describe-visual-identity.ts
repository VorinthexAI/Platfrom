import { IMAGE_CAPTION_MODEL } from '@/lib/image-caption-constants';
import type { ActionDefinition } from './types';

export const describeVisualIdentityAction = {
  id: 'describe-visual-identity',
  modelPolicy: 'required',
  models: [{ provider: 'openrouter', model: IMAGE_CAPTION_MODEL, priority: 100 }],
} as const satisfies ActionDefinition;
