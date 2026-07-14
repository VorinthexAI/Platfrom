import type { ActionDefinition, ActionId } from './types';

export const VIDEO_ACTIONS = {
  'video.generate': {
    id: 'video.generate',
    name: 'Generate Video',
    description: 'Generate a new video from text and optional reference media.',
    safeToRetry: false,
  },

  'video.edit': {
    id: 'video.edit',
    name: 'Edit Video',
    description: 'Modify an existing video using instructions.',
    safeToRetry: false,
  },

  'video.extend': {
    id: 'video.extend',
    name: 'Extend Video',
    description: 'Continue an existing video beyond its current end.',
    safeToRetry: false,
  },

  'video.analyze': {
    id: 'video.analyze',
    name: 'Analyze Video',
    description: 'Extract structured insights, descriptions, or answers from a video.',
    safeToRetry: true,
  },

  'video.create-variation': {
    id: 'video.create-variation',
    name: 'Create Video Variation',
    description: 'Produce an alternative take of an existing video.',
    safeToRetry: false,
  },
} satisfies Partial<Record<ActionId, ActionDefinition>>;
