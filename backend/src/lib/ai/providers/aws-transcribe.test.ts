import { afterEach, describe, expect, test } from 'bun:test';
import { s3 } from '@/lib/s3';
import { createAwsTranscribeProvider } from './aws-transcribe';

const originalFetch = globalThis.fetch;
const originalSend = s3.send.bind(s3);

afterEach(() => {
  globalThis.fetch = originalFetch;
  s3.send = originalSend;
});

describe('AWS Transcribe provider', () => {
  test('uploads, transcribes, and cleans up audio', async () => {
    const commands: string[] = [];
    s3.send = (async (command) => { commands.push(command.constructor.name); return {}; }) as typeof s3.send;
    let requestNumber = 0;
    globalThis.fetch = (async () => {
      requestNumber += 1;
      if (requestNumber === 1) return new Response('{}', { status: 200 });
      if (requestNumber === 2) return new Response(JSON.stringify({ TranscriptionJob: { TranscriptionJobStatus: 'COMPLETED', Transcript: { TranscriptFileUri: 'https://example.com/transcript.json' } } }), { status: 200 });
      return new Response(JSON.stringify({ results: { transcripts: [{ transcript: 'recognized text' }] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createAwsTranscribeProvider({ region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret' });
    const result = await provider.execute({ actionId: 'transcribe', modelId: 'aws.transcribe-standard', externalModelId: 'standard', input: { audioBase64: 'AQID', mimeType: 'audio/mpeg' }, organizationKey: 'organization', timeoutMs: 2_000 });
    expect(result.output).toEqual({ text: 'recognized text' });
    expect(commands).toEqual(['PutObjectCommand', 'DeleteObjectCommand']);
  });
});
