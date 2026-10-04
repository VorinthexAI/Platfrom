import { referralRedeemInputSchema, referralRedeemResultSchema } from '@/lib/referrals/contracts';
import { referralService } from '@/lib/referrals/service';
import { contentZodToJsonSchema } from './content-json-schema';
import type { PublicToolDependencies } from './tool-definition';

export const referralRedeemToolDefinition = {
  name: 'referral.redeem',
  inputSchema: referralRedeemInputSchema,
  providerDefinition: {
    name: 'referral.redeem',
    description: 'Apply a referral code to the authenticated user account.',
    inputSchema: contentZodToJsonSchema(referralRedeemInputSchema),
  },
  isReadOnly: () => false,
  async execute(rawInput: unknown, dependencies: PublicToolDependencies) {
    const { code } = referralRedeemInputSchema.parse(rawInput);
    const principal = dependencies.context.principal;
    if (principal.kind !== 'member' || principal.userTeam.status !== 'active' || principal.userTeam.userId !== principal.user.key || principal.userTeam.teamKey !== dependencies.context.teamKey) {
      throw new Error('referral.redeem requires an active authenticated user membership.');
    }
    return referralRedeemResultSchema.parse(await referralService.redeem(principal.user.key, code));
  },
};
