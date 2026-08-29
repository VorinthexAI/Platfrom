import { describe, expect, test } from 'bun:test';
import { generateSpeechAction, speechInputSchema, speechOutputSchema } from './generate-speech';

describe('generate-speech action', () => {
  test('defines a strict provider-neutral narration contract', () => {
    expect(generateSpeechAction).toMatchObject({ id: 'generate-speech', modelPolicy: 'required' });
    expect(generateSpeechAction.models).toEqual([{ provider: 'aws-polly', model: 'amazon.polly-neural', priority: 100 }]);
    expect(speechInputSchema.parse({ text: 'Chapter prose', voice: 'coral', pace: 1.37, format: 'mp3' })).toMatchObject({ pace: 1.37 });
    expect(() => speechInputSchema.parse({ text: 'Chapter prose', voice: 'custom', pace: 1, format: 'mp3' })).toThrow();
    expect(() => speechInputSchema.parse({ text: 'Chapter prose', voice: 'coral', pace: 2.1, format: 'mp3' })).toThrow();
    expect(speechOutputSchema.parse({ base64: 'YXVkaW8=', mimeType: 'audio/mpeg' })).toBeDefined();
  });
});
