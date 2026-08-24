import { expect, test } from 'bun:test';
import { createAppTransformationService } from './service';

test('enhances and translates through strict provider-neutral text generation', async () => {
  const prompts: string[] = [];
  const service = createAppTransformationService({ generate: async (_organizationKey, request) => {
    prompts.push(request.systemPrompt);
    return prompts.length === 1 ? 'Clear sentence.' : 'Phrase claire.';
  } });
  await expect(service.enhance({ text: 'Bad sentnce.' }, 'organization')).resolves.toEqual({ text: 'Clear sentence.' });
  await expect(service.translate({ text: 'Clear sentence.', targetLanguage: 'French' }, 'organization')).resolves.toEqual({ text: 'Phrase claire.' });
  expect(prompts[0]).toContain('spelling, grammar, punctuation');
  expect(prompts[1]).toContain('into French');
  await expect(service.enhance({ text: 'Draft', forged: true } as never, 'organization')).rejects.toThrow('Unrecognized key');
});
