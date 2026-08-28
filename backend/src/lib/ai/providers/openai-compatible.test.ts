import { expect, test } from 'bun:test';
import { buildChatCompletionParams } from './openai-compatible';

test('maps provider-neutral tool calls and results to OpenAI-compatible messages', () => {
  const params = buildChatCompletionParams('model', {
    responseFormat: { name: 'place_result', schema: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' } } } },
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Tell me about Iceland' }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call-1', name: 'place.find', arguments: { query: 'Iceland' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1', result: { place: { title: 'Iceland' } } }] },
    ],
  }, { maxTokensParam: 'max_tokens' });

  expect(params.messages).toEqual([
    { role: 'user', content: 'Tell me about Iceland' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'place.find', arguments: '{"query":"Iceland"}' } }] },
    { role: 'tool', tool_call_id: 'call-1', content: '{"place":{"title":"Iceland"}}' },
  ]);
  expect(params.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'place_result', strict: true, schema: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' } } } } });
});
