import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import {
  transcribeInputSchema,
  type ProviderExecuteResponse,
  type TranscribeInput,
  type TranscriptionOutput,
} from '@/lib/ai/providers';

export interface TranscribeToolDependencies extends ExecuteActionOptions {
  organizationKey?: string;
  executeTranscription?: (
    organizationKey: string,
    input: TranscribeInput,
  ) => Promise<ProviderExecuteResponse<TranscriptionOutput>>;
}

export const transcribeTool = {
  name: 'transcribe',
  inputSchema: transcribeInputSchema,
  providerDefinition: {
    name: 'transcribe',
    description: 'Transcribe supplied audio into text.',
    inputSchema: {
      type: 'object',
      required: ['audioBase64', 'mimeType'],
      additionalProperties: false,
      properties: {
        audioBase64: { type: 'string', minLength: 1 },
        mimeType: { type: 'string', minLength: 1 },
        language: { type: 'string' },
        prompt: { type: 'string', maxLength: 4_000 },
      },
    },
  },
  async execute(
    rawInput: unknown,
    dependencies: TranscribeToolDependencies = {},
  ): Promise<TranscriptionOutput> {
    const input = transcribeInputSchema.parse(rawInput);
    const organizationKey = dependencies.organizationKey ?? 'nexus';
    if (dependencies.executeTranscription) {
      return (await dependencies.executeTranscription(organizationKey, input)).output;
    }
    return (await executeAction<TranscribeInput, TranscriptionOutput>(
      { mode: 'auto', organizationKey, actionSlug: 'transcribe' },
      input,
      dependencies,
    )).output;
  },
} as const;
