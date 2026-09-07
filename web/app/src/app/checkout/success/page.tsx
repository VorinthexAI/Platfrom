import type { Metadata } from "next";
import { AppReturnFallback } from "@/components/private/AppReturnFallback";

export const metadata: Metadata = {
  title: "Checkout complete",
  description: "Return to Vorinthex Core after checkout.",
};

export default function CheckoutSuccessPage() {
  return <AppReturnFallback kind="success" />;
}
