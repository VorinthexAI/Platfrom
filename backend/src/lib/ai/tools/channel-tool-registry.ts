import { z } from 'zod';
import { CHANNEL_TOOL_DEFINITIONS, CHANNEL_TOOL_SLUGS, channelToolInputSchemas, type ChannelToolSlug } from '@/lib/ai/channel/tools';

export const CHANNEL_TOOL_NAMES = Object.freeze([...CHANNEL_TOOL_SLUGS]);
export const channelToolNameSchema = z.enum(CHANNEL_TOOL_NAMES as [ChannelToolSlug, ...ChannelToolSlug[]]);

export const channelToolOutputSchema = z.object({
  tool: channelToolNameSchema,
  status: z.enum(['completed', 'not_implemented']),
  data: z.unknown().optional(),
}).strict();

export type ChannelToolOutput = z.infer<typeof channelToolOutputSchema>;

export const channelToolOutputSchemas = Object.fromEntries(
  CHANNEL_TOOL_NAMES.map((name) => [name, channelToolOutputSchema]),
) as { [Name in ChannelToolSlug]: typeof channelToolOutputSchema };

export const CHANNEL_REGISTERED_TOOL_DEFINITIONS = Object.freeze(CHANNEL_TOOL_DEFINITIONS.map((definition) => Object.freeze({
  ...definition,
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['tool', 'status'],
    properties: {
      tool: { type: 'string', enum: [definition.name] },
      status: { type: 'string', enum: ['completed', 'not_implemented'] },
      data: {},
    },
  },
})));

export function isChannelToolName(value: string): value is ChannelToolSlug {
  return Object.prototype.hasOwnProperty.call(channelToolInputSchemas, value);
}
