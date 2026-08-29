import { describe, expect, test } from 'bun:test';
import type { SynthesizeSpeechCommand, SynthesizeSpeechCommandOutput } from '@aws-sdk/client-polly';
import { buildPollySpeechSsml, createAwsPollyProvider, extractPollyMp3Frames, splitPollySpeechText } from './aws-polly';

function mp3Frame(fill: number): Uint8Array {
  const header = (0xffe00000 | (0b10 << 19) | (0b01 << 17) | (1 << 16) | (6 << 12) | (1 << 10)) >>> 0;
  const frame = Buffer.alloc(144, fill);
  frame.writeUInt32BE(header, 0);
  return frame;
}

function audioResponse(bytes: Uint8Array, requestCharacters: number): SynthesizeSpeechCommandOutput {
  return {
    AudioStream: { transformToByteArray: async () => bytes } as SynthesizeSpeechCommandOutput['AudioStream'],
    ContentType: 'audio/mpeg',
    RequestCharacters: requestCharacters,
    $metadata: {},
  };
}

describe('Amazon Polly provider', () => {
  test('builds safe SSML and keeps every long-text request within Polly limits', () => {
    expect(buildPollySpeechSsml('One & <two>', 1.25)).toBe('<speak><prosody rate="125%">One &amp; &lt;two&gt;</prosody></speak>');
    const chunks = splitPollySpeechText(`${'<'.repeat(2_000)} ${'narration '.repeat(800)}`, 1);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 3_000 && buildPollySpeechSsml(chunk, 1).length <= 6_000)).toBe(true);
  });

  test('extracts MPEG frames and measures their duration', () => {
    const parsed = extractPollyMp3Frames(Buffer.concat([Buffer.from('ID3metadata'), mp3Frame(1), mp3Frame(2)]));
    expect(parsed.bytes.length).toBe(288);
    expect(parsed.durationSeconds).toBeCloseTo(0.048, 5);
  });

  test('generates and joins native MP3 chunks with the selected neural voice and pace', async () => {
    const commands: SynthesizeSpeechCommand[] = [];
    const transport = {
      async send(command: SynthesizeSpeechCommand) {
        commands.push(command);
        return audioResponse(Buffer.concat([mp3Frame(commands.length), mp3Frame(commands.length)]), command.input.Text?.length ?? 0);
      },
    };
    const provider = createAwsPollyProvider({ region: 'eu-central-1' }, transport);
    const result = await provider.execute({
      actionId: 'generate-speech',
      modelId: 'amazon.polly-neural',
      externalModelId: 'neural',
      organizationKey: 'org',
      input: { text: `First chapter. ${'word '.repeat(800)}`, voice: 'coral', pace: 1.25, format: 'mp3' },
    });

    expect(commands.length).toBeGreaterThan(1);
    expect(commands[0]!.input).toMatchObject({ Engine: 'neural', LanguageCode: 'en-US', OutputFormat: 'mp3', SampleRate: '24000', TextType: 'ssml', VoiceId: 'Joanna' });
    expect(commands[0]!.input.Text).toContain('<prosody rate="125%">');
    expect(Buffer.from((result.output as { base64: string }).base64, 'base64').length).toBe(commands.length * 288);
    expect(result.output).toMatchObject({ mimeType: 'audio/mpeg', durationSeconds: 1 });
    expect(result.providerId).toBe('aws-polly');
    expect(result.costUsd).toBeGreaterThan(0);
  });

  test('selects a neural voice for the requested narration language and rejects unsupported languages', async () => {
    let command: SynthesizeSpeechCommand | undefined;
    const provider = createAwsPollyProvider({ region: 'eu-central-1' }, { async send(next: SynthesizeSpeechCommand) { command = next; return audioResponse(mp3Frame(1), 10); } });
    await provider.execute({ actionId: 'generate-speech', modelId: 'amazon.polly-neural', externalModelId: 'neural', organizationKey: 'org', input: { text: 'Bonjour le monde', language: 'French', voice: 'coral', pace: 1, format: 'mp3' } });
    expect(command!.input).toMatchObject({ LanguageCode: 'fr-FR', VoiceId: 'Lea' });
    await expect(provider.execute({ actionId: 'generate-speech', modelId: 'amazon.polly-neural', externalModelId: 'neural', organizationKey: 'org', input: { text: 'Narrate', language: 'Unsupported', voice: 'alloy', pace: 1, format: 'mp3' } })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  test('rejects malformed MP3 responses', async () => {
    const provider = createAwsPollyProvider({ region: 'eu-central-1' }, { async send() { return audioResponse(new Uint8Array([1, 2, 3]), 3); } });
    await expect(provider.execute({ actionId: 'generate-speech', modelId: 'amazon.polly-neural', externalModelId: 'neural', organizationKey: 'org', input: { text: 'Bad audio', voice: 'alloy', pace: 1, format: 'mp3' } })).rejects.toMatchObject({ code: 'response_invalid' });
  });
});
