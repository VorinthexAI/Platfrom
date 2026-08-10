import { expect, test } from 'bun:test';
import { contentInstructToolDefinition } from './content-instruct';

test('defines strict content instruction input and output', () => {
  expect(contentInstructToolDefinition.name).toBe('content.instruct');
  expect(contentInstructToolDefinition.providerDefinition.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
  expect(contentInstructToolDefinition.providerDefinition.outputSchema).toMatchObject({ type: 'object', additionalProperties: false });
});
