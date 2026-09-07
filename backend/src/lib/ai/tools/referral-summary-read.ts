import { referralSummaryReadInputSchema, referralSummarySchema } from '@/lib/referrals/contracts';
import { referralService } from '@/lib/referrals/service';
import type { PublicToolDependencies } from './tool-definition';

export function createReferralSummaryReadTool(readSummary: typeof referralService.readSummary = referralService.readSummary) {
  return {
    name: 'referral.summary.read',
    inputSchema: referralSummaryReadInputSchema,
    isReadOnly: () => true,
    providerDefinition: {
      name: 'referral.summary.read',
      description: 'Read the authenticated user\'s referral code and current referral reward summary.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    },
    async execute(rawInput: unknown, dependencies: PublicToolDependencies) {
      referralSummaryReadInputSchema.parse(rawInput);
      const principal = dependencies.context.principal;
      if (principal.kind !== 'member' || principal.userTeam.status !== 'active' || principal.userTeam.userId !== principal.user.key || principal.userTeam.teamKey !== dependencies.context.teamKey) {
        throw new Error('referral.summary.read requires an active authenticated user membership.');
      }
      return referralSummarySchema.parse(await readSummary(principal.user.key));
    },
  } as const;
}

export const referralSummaryReadToolDefinition = createReferralSummaryReadTool();
