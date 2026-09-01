import { z } from 'zod';

const boundedUnknownSchema = z.unknown().refine((value) => {
  try { return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') <= 40_000; } catch { return false; }
}, 'Serialized value exceeds 40000 bytes.');

export const agentContextMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(100_000),
  createdAt: z.string().datetime(),
}).strict();

export const internalAgentRequestSchema = z.object({
  systemPrompt: z.string().trim().min(1).max(20_000),
  context: z.array(agentContextMessageSchema).max(50).optional(),
  message: z.string().trim().min(1).max(20_000),
  currentDate: z.string().datetime(),
  requestKey: z.string().trim().min(1).max(180),
  generateName: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (Buffer.byteLength(JSON.stringify(value.context ?? []), 'utf8') > 250_000) {
    context.addIssue({ code: 'custom', path: ['context'], message: 'Serialized context exceeds 250000 bytes.' });
  }
});
export type InternalAgentRequest = z.infer<typeof internalAgentRequestSchema>;

export const coreAgentToolInputSchema = z.object({
  context: z.array(agentContextMessageSchema).max(50).optional(),
  message: z.string().trim().min(1).max(20_000),
  generateName: z.boolean().default(false),
}).strict();

export const agentRoutingOutputSchema = z.object({
  tools: z.array(z.string().min(1)).max(20),
  message: z.string().max(100_000),
  name: z.string().trim().min(1).max(200).optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.tools).size !== value.tools.length) context.addIssue({ code: 'custom', path: ['tools'], message: 'Routing tools must be unique.' });
  if (value.tools.length && value.message !== '') context.addIssue({ code: 'custom', path: ['message'], message: 'A tool selection message must be empty.' });
  if (!value.tools.length && !value.message.trim()) context.addIssue({ code: 'custom', path: ['message'], message: 'A direct routing message must not be blank.' });
});
export type AgentRoutingOutput = z.infer<typeof agentRoutingOutputSchema>;

export const agentToolInvocationSchema = z.object({
  slug: z.string().min(1),
  arguments: boundedUnknownSchema,
}).strict();

export const agentToolStatusSchema = agentToolInvocationSchema.extend({
  status: z.enum(['succeeded', 'failed']),
  result: boundedUnknownSchema.optional(),
  error: z.string().min(1).max(1_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'succeeded' && value.result === undefined) context.addIssue({ code: 'custom', path: ['result'], message: 'A succeeded tool requires a result.' });
  if (value.status === 'succeeded' && value.error !== undefined) context.addIssue({ code: 'custom', path: ['error'], message: 'A succeeded tool cannot contain an error.' });
  if (value.status === 'failed' && value.error === undefined) context.addIssue({ code: 'custom', path: ['error'], message: 'A failed tool requires an error.' });
  if (value.status === 'failed' && value.result !== undefined) context.addIssue({ code: 'custom', path: ['result'], message: 'A failed tool cannot contain a result.' });
});
export type AgentToolStatus = z.infer<typeof agentToolStatusSchema>;

export const agentResponseSchema = z.object({
  message: z.string().max(100_000).refine((value) => value.trim().length > 0, 'Agent message must not be blank.'),
  name: z.string().trim().min(1).max(200).optional(),
  tools: z.array(agentToolStatusSchema).max(4),
}).strict();
export type AgentResponse = z.infer<typeof agentResponseSchema>;

export const agentToolPatternSchema = z.string().regex(/^[a-z][a-z0-9-]*(?:\.(?:[a-z][a-z0-9-]*|\*))+$/);

export interface AgentDefinition {
  slug: string;
  systemPrompt: string;
  allowlist: readonly string[];
  excludedTools: readonly string[];
}
