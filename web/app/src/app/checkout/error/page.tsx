import type { Metadata } from "next";
import { AppReturnFallback } from "@/components/private/AppReturnFallback";

export const metadata: Metadata = {
  title: "Return to checkout",
  description: "Return to Vorinthex Core and retry checkout.",
};

export default function CheckoutErrorPage() {
  return <AppReturnFallback kind="error" />;
}
