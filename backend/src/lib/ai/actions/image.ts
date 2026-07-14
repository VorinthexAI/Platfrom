import type { ActionDefinition, ActionId } from './types';

export const IMAGE_ACTIONS = {
  'image.generate': {
    id: 'image.generate',
    name: 'Generate Image',
    description: 'Generate a new image from text and optional references.',
    safeToRetry: false,
  },

  'image.edit': {
    id: 'image.edit',
    name: 'Edit Image',
    description: 'Modify an existing image using instructions.',
    safeToRetry: false,
  },

  'image.create-slideshow': {
    id: 'image.create-slideshow',
    name: 'Create Slideshow',
    description: 'Create a structured visual slideshow.',
    safeToRetry: false,
  },
} satisfies Partial<Record<ActionId, ActionDefinition>>;
