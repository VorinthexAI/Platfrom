import type { Metadata } from "next";
import { CheckoutHandoff } from "./CheckoutHandoff";

export const metadata: Metadata = {
  title: "Secure checkout",
  description: "Continue a private Vorinthex checkout.",
};

export default function CheckoutPage() {
  return <CheckoutHandoff />;
}
