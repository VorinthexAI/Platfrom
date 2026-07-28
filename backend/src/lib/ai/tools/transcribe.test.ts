import { describe, expect, test } from 'bun:test';
import { transcribeTool } from './transcribe';

describe('transcribe tool', () => {
  test('validates input and delegates directly to the transcribe action executor', async () => {
    let receivedOrganization = '';
    let receivedInput: unknown;
    const output = await transcribeTool.execute({
      audioBase64: 'cGNt',
      mimeType: 'audio/pcm',
      prompt: 'Use @Atlas for the spoken mention.',
    }, {
      organizationKey: 'organization-key',
      async executeTranscription(organizationKey, input) {
        receivedOrganization = organizationKey;
        receivedInput = input;
        return { output: { text: '@Atlas hello' } } as never;
      },
    });

    expect(receivedOrganization).toBe('organization-key');
    expect(receivedInput).toEqual({
      audioBase64: 'cGNt',
      mimeType: 'audio/pcm',
      prompt: 'Use @Atlas for the spoken mention.',
    });
    expect(output).toEqual({ text: '@Atlas hello' });
    await expect(transcribeTool.execute({ audioBase64: '', mimeType: 'audio/pcm' }, {
      executeTranscription: async () => ({}) as never,
    })).rejects.toThrow();
  });

  test('routes the default execution through the transcribe action', async () => {
    const source = await Bun.file(new URL('./transcribe.ts', import.meta.url)).text();
    expect(transcribeTool.name).toBe('transcribe');
    expect(source).toContain("actionSlug: 'transcribe'");
    expect(source).toContain("mode: 'auto'");
    expect(source).not.toContain('gpt-realtime-2');
  });
});
