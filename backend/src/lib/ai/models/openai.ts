import type { ModelDefinition, ModelId } from './types';

export const OPENAI_MODELS = {
  'openai.gpt-5': {
    id: 'openai.gpt-5',
    name: 'GPT-5',
    actions: ['core.reason', 'core.ask'],
    actionProfiles: {
      'core.reason': { quality: 0.95, speed: 0.45, costEfficiency: 0.35, reliability: 0.9 },
      'core.ask': { quality: 0.9, speed: 0.55, costEfficiency: 0.4, reliability: 0.9 },
    },
    routes: [
      { providerId: 'openai', externalModelId: 'gpt-5', enabled: true },
      // Azure deployment names are tenant-specific — enable once a
      // deployment for this model exists in the Foundry resource.
      { providerId: 'azure-ai-foundry', externalModelId: 'gpt-5', enabled: false },
      { providerId: 'openrouter', externalModelId: 'openai/gpt-5', enabled: true },
    ],
    enabled: true,
  },

  'openai.gpt-5-mini': {
    id: 'openai.gpt-5-mini',
    name: 'GPT-5 mini',
    actions: ['core.reason', 'core.ask'],
    actionProfiles: {
      'core.reason': { quality: 0.75, speed: 0.8, costEfficiency: 0.85, reliability: 0.9 },
      'core.ask': { quality: 0.75, speed: 0.85, costEfficiency: 0.9, reliability: 0.9 },
    },
    routes: [
      { providerId: 'openai', externalModelId: 'gpt-5-mini', enabled: true },
      { providerId: 'openrouter', externalModelId: 'openai/gpt-5-mini', enabled: true },
    ],
    enabled: true,
  },

  'openai.gpt-image': {
    id: 'openai.gpt-image',
    name: 'GPT Image',
    actions: ['image.generate'],
    actionProfiles: {
      'image.generate': { quality: 0.9, speed: 0.4, costEfficiency: 0.5, reliability: 0.85 },
    },
    routes: [{ providerId: 'openai', externalModelId: 'gpt-image-1', enabled: true }],
    enabled: true,
  },

  'openai.whisper': {
    id: 'openai.whisper',
    name: 'Whisper',
    actions: ['audio.transcribe'],
    actionProfiles: {
      'audio.transcribe': { quality: 0.85, speed: 0.7, costEfficiency: 0.8, reliability: 0.9 },
    },
    routes: [{ providerId: 'openai', externalModelId: 'whisper-1', enabled: true }],
    enabled: true,
  },

  'openai.tts': {
    id: 'openai.tts',
    name: 'OpenAI TTS',
    actions: ['audio.generate-speech'],
    actionProfiles: {
      'audio.generate-speech': { quality: 0.8, speed: 0.8, costEfficiency: 0.8, reliability: 0.9 },
    },
    routes: [{ providerId: 'openai', externalModelId: 'gpt-4o-mini-tts', enabled: true }],
    enabled: true,
  },
} satisfies Partial<Record<ModelId, ModelDefinition>>;
