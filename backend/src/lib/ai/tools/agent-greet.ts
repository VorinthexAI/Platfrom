import { z } from 'zod';
import { agentGreetingOccasionSchema, agentGreetingContextFromUser, generateAgentGreeting, streamAgentGreeting } from '@/lib/ai/agents/greeting';
import type { PublicToolDependencies } from './tool-definition';

export const agentGreetInputSchema = z.object({ occasion: agentGreetingOccasionSchema }).strict();
export const agentGreetOutputSchema = z.object({ occasion: agentGreetingOccasionSchema, greetingState: z.enum(['new-account', 'returning']), message: z.string().trim().min(1).max(500) }).strict();

export const agentGreetToolDefinition = {
  name: 'agent.greet',
  inputSchema: agentGreetInputSchema,
  isReadOnly: () => true,
  providerDefinition: { name: 'agent.greet', description: 'Generate a short opening greeting for the authorized user.', inputSchema: { type: 'object', additionalProperties: false, properties: { occasion: { type: 'string', enum: ['onboarding', 'returning'] } }, required: ['occasion'] } },
  async execute(raw: unknown, dependencies: PublicToolDependencies) {
    const input = agentGreetInputSchema.parse(raw);
    if (dependencies.context.principal.kind !== 'member') throw new Error('A member session is required for a greeting.');
    const greetingState = input.occasion === 'onboarding' ? 'new-account' as const : 'returning' as const;
    const context = agentGreetingContextFromUser(dependencies.context.principal.user);
    const options = { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs };
    const generated = dependencies.onGreetingDelta
      ? await streamAgentGreeting(dependencies.context.teamKey, greetingState, context, dependencies.onGreetingDelta, options)
      : await generateAgentGreeting(dependencies.context.teamKey, greetingState, context, options);
    return agentGreetOutputSchema.parse({ occasion: input.occasion, greetingState, message: generated.message });
  },
} as const;
