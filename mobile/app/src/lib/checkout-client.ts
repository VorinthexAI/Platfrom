import { z } from "zod";

import { apiClient } from "./api-client";
import { productIdSchema } from "./product-client";

const polarCheckoutUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:"
    && url.username === ""
    && url.password === ""
    && url.port === ""
    && ["polar.sh", "www.polar.sh", "checkout.polar.sh", "sandbox.polar.sh"].includes(url.hostname);
}, "Checkout URL must use an allowed Polar HTTPS host.");

const checkoutEnvelopeSchema = z.strictObject({
  success: z.literal(true),
  data: z.strictObject({
    key: z.string().cuid(),
    status: z.enum(["open", "completed"]),
    url: polarCheckoutUrlSchema,
  }),
});

export type CheckoutCallback = "error" | "success";
export const CHECKOUT_SUCCESS_URL = "vorinthexcore://checkout/success";

export async function createCheckout(productId: z.infer<typeof productIdSchema>, idempotencyKey: string) {
  const response = await apiClient.post("/payments/checkouts", { productId: productIdSchema.parse(productId) }, {
    headers: { "Idempotency-Key": z.string().uuid().parse(idempotencyKey) },
  });
  return checkoutEnvelopeSchema.parse(response.data).data;
}

export function checkoutCallbackFromUrl(url: string): CheckoutCallback | undefined {
  if (/^vorinthexcore:\/\/checkout\/success(?:[/?#]|$)/.test(url)) return "success";
  if (/^vorinthexcore:\/\/checkout\/error(?:[/?#]|$)/.test(url)) return "error";
  return undefined;
}
