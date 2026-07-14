import type { ActionDefinition, ActionId } from './types';

export const AUDIO_ACTIONS = {
  'audio.transcribe': {
    id: 'audio.transcribe',
    name: 'Transcribe Audio',
    description: 'Convert speech in an audio file into text.',
    safeToRetry: true,
  },

  'audio.generate-speech': {
    id: 'audio.generate-speech',
    name: 'Generate Speech',
    description: 'Synthesize spoken audio from text.',
    safeToRetry: false,
  },

  'audio.analyze': {
    id: 'audio.analyze',
    name: 'Analyze Audio',
    description: 'Extract structured insights or answers from an audio file.',
    safeToRetry: true,
  },

  'audio.generate-music': {
    id: 'audio.generate-music',
    name: 'Generate Music',
    description: 'Compose new music from a text brief.',
    safeToRetry: false,
  },
} satisfies Partial<Record<ActionId, ActionDefinition>>;
