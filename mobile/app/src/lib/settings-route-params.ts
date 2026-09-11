import { z } from "zod";

export const settingsRouteParamsSchema = z.union([
  z.strictObject({ sheet: z.literal("referral"), mode: z.enum(["share", "redeem"]) }),
  z.strictObject({ sheet: z.undefined().optional(), mode: z.undefined().optional() }),
]);

export function referralSettingsInitialState(value: unknown) {
  const parsed = settingsRouteParamsSchema.safeParse(value);
  return parsed.success && parsed.data.sheet === "referral"
    ? { sheet: parsed.data.sheet, referralMode: parsed.data.mode } as const
    : undefined;
}
