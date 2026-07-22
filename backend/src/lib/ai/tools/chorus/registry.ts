import { z } from 'zod';
import { CHORUS_TOOL_DEFINITIONS, CHORUS_TOOL_SLUGS, chorusToolInputSchemas, type ChorusToolSlug } from '@/lib/ai/chorus/tools';

export const CHORUS_TOOL_NAMES = Object.freeze([...CHORUS_TOOL_SLUGS]);
export const chorusToolNameSchema = z.enum(CHORUS_TOOL_NAMES as [ChorusToolSlug, ...ChorusToolSlug[]]);

export const chorusToolOutputSchema = z.object({
  tool: chorusToolNameSchema,
  status: z.enum(['completed', 'not_implemented']),
  data: z.unknown().optional(),
}).strict();

export type ChorusToolOutput = z.infer<typeof chorusToolOutputSchema>;

export const chorusToolOutputSchemas = Object.fromEntries(
  CHORUS_TOOL_NAMES.map((name) => [name, chorusToolOutputSchema]),
) as { [Name in ChorusToolSlug]: typeof chorusToolOutputSchema };

export const CHORUS_REGISTERED_TOOL_DEFINITIONS = Object.freeze(CHORUS_TOOL_DEFINITIONS.map((definition) => Object.freeze({
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

export function isChorusToolName(value: string): value is ChorusToolSlug {
  return Object.prototype.hasOwnProperty.call(chorusToolInputSchemas, value);
}
