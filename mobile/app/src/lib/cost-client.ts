import { z } from "zod";

import { fetchPublic } from "./product-client";

const chargeBaseSchema = z.strictObject({
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(300),
});

const staticChargeSchema = chargeBaseSchema.extend({
  kind: z.literal("static"),
  sparkCost: z.string().regex(/^[1-9]\d*(?:\.\d{1,6})?$/),
  unit: z.enum(["invocation", "documents", "images", "new-email"]),
});

const storageChargeSchema = chargeBaseSchema.extend({
  kind: z.literal("storage"),
  sparkCost: z.string().regex(/^[1-9]\d*(?:\.\d{1,6})?$/),
  unit: z.literal("gb-month"),
});

const variableChargeSchema = chargeBaseSchema.extend({ kind: z.literal("variable") });

export const sparkCostsResponseSchema = z.strictObject({
  success: z.literal(true),
  data: z.strictObject({
    capabilityCosts: z.record(z.string(), z.strictObject({
      sparkCost: z.string().regex(/^[1-9]\d*(?:\.\d{1,6})?$/),
      microSparkCost: z.number().int().safe().positive(),
      unit: z.literal("invocation"),
    })),
    charges: z.array(z.discriminatedUnion("kind", [staticChargeSchema, storageChargeSchema, variableChargeSchema])).max(100),
  }),
});

export type SparkCharge = z.infer<typeof sparkCostsResponseSchema>["data"]["charges"][number];
export type CapabilitySparkCost = z.infer<typeof sparkCostsResponseSchema>["data"]["capabilityCosts"][string];
export type SparkCosts = z.infer<typeof sparkCostsResponseSchema>["data"];

export async function fetchSparkCosts() {
  return sparkCostsResponseSchema.parse(await fetchPublic("costs")).data;
}
