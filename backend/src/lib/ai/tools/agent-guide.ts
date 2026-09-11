import { z } from 'zod';
import { agentGreetingOccasionSchema, generateAgentGreeting, type AgentGreetingExecutor } from '@/lib/ai/agents/greeting';
import type { PublicToolDependencies } from './tool-definition';
import { referralService, type ReferralService } from '@/lib/referrals/service';
import { initialWorkspaceDocumentKey, INITIAL_WORKSPACE_DOCUMENT_IDS } from '@/lib/initial-workspace-content-identifiers';
import { runContentTool } from './content-runtime';

export const agentGuideInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.enum(['recommend', 'explain']) }).strict(),
  z.object({ mode: z.literal('greet'), occasion: agentGreetingOccasionSchema }).strict(),
]);

const workspaceGuideSchema = z.object({ id: z.enum(INITIAL_WORKSPACE_DOCUMENT_IDS), title: z.string().trim().min(1).max(255), content: z.string().trim().min(1) }).strict();
export const agentGuideOutputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.enum(['recommend', 'explain']), guides: z.array(workspaceGuideSchema).min(1).max(INITIAL_WORKSPACE_DOCUMENT_IDS.length) }).strict(),
  z.object({ mode: z.literal('greet'), occasion: agentGreetingOccasionSchema, message: z.string().trim().min(1).max(500), showReferralCodeAction: z.boolean() }).strict(),
]);

const recommendationGuideIds = INITIAL_WORKSPACE_DOCUMENT_IDS.filter((id) => id.endsWith('-start'));
const explanationGuideIds = INITIAL_WORKSPACE_DOCUMENT_IDS.filter((id) => !id.endsWith('-start'));

export function createAgentGuideTool(options: {
  executeGreeting?: AgentGreetingExecutor;
  referrals?: Pick<ReferralService, 'readRedemptionStatus'>;
} = {}) {
  const referrals = options.referrals ?? referralService;
  return {
    name: 'agent.guide',
    inputSchema: agentGuideInputSchema,
    isReadOnly: () => true,
    providerDefinition: {
      name: 'agent.guide',
      description: 'Read the current scope\'s canonical seeded guidance documents. Use mode recommend for first-step guidance. Use mode explain for product explanations. Do not use this for finding other user-owned workspace resources; use app.search for those.',
      inputSchema: {
        oneOf: [
          { type: 'object', additionalProperties: false, properties: { mode: { type: 'string', enum: ['recommend', 'explain'] } }, required: ['mode'] },
        ],
      },
    },
    async execute(rawInput: unknown, dependencies?: PublicToolDependencies) {
      const input = agentGuideInputSchema.parse(rawInput);
      if (input.mode === 'greet') {
        if (!dependencies) throw new Error('agent.guide greeting requires trusted execution context.');
        const principal = dependencies.context.principal;
        const redemption = input.occasion === 'onboarding' && principal.kind === 'member' ? await referrals.readRedemptionStatus(principal.user.key) : undefined;
        const showReferralCodeAction = input.occasion === 'onboarding' && redemption?.attributed !== true;
        const message = await generateAgentGreeting(dependencies.context.teamKey, input.occasion, { shouldAskReferral: redemption ? !redemption.attributed : undefined }, {
          signal: dependencies.signal,
          timeoutMs: dependencies.timeoutMs,
        }, options.executeGreeting);
        return agentGuideOutputSchema.parse({ mode: input.mode, occasion: input.occasion, message, showReferralCodeAction });
      }
      if (!dependencies) throw new Error('agent.guide requires trusted execution context.');
      const ids = input.mode === 'recommend' ? recommendationGuideIds : explanationGuideIds;
      const keys = ids.map((id) => initialWorkspaceDocumentKey(dependencies.context.runtimeScopeKey, id));
      const output = await (dependencies.executeContent ?? runContentTool)('document.read', { documentKeys: keys }, dependencies.context, dependencies.content);
      const documents = new Map(output.results.flatMap((result) => result.success && result.data ? [[result.data.documentKey, result.data] as const] : []));
      const guides = ids.map((id, index) => {
        const document = documents.get(keys[index]!);
        if (!document) throw new Error(`Canonical workspace guide ${id} is unavailable.`);
        return { id, title: document.title, content: document.content };
      });
      return agentGuideOutputSchema.parse({ mode: input.mode, guides });
    },
  } as const;
}

export const agentGuideToolDefinition = createAgentGuideTool();
