import { z } from "zod";

import { apiClient } from "./api-client";
import { productIdSchema } from "./product-client";

const checkoutHandoffEnvelopeSchema = z.strictObject({
  success: z.literal(true),
  data: z.strictObject({
    url: z.string().url(),
    expiresAt: z.string().datetime({ offset: true }),
  }),
});

export type CheckoutCallback = "error" | "success";
export const CHECKOUT_SUCCESS_URL = "vorinthexcore://checkout/success";

export async function createCheckoutHandoff(productId: z.infer<typeof productIdSchema>, idempotencyKey: string) {
  const response = await apiClient.post("/payments/checkout-handoffs", { productId: productIdSchema.parse(productId) }, {
    headers: { "Idempotency-Key": z.string().uuid().parse(idempotencyKey) },
  });
  return checkoutHandoffEnvelopeSchema.parse(response.data).data;
}

export function checkoutCallbackFromUrl(url: string): CheckoutCallback | undefined {
  if (/^vorinthexcore:\/\/checkout\/success(?:[/?#]|$)/.test(url)) return "success";
  if (/^vorinthexcore:\/\/checkout\/error(?:[/?#]|$)/.test(url)) return "error";
  return undefined;
}
