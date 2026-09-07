import { handleCheckoutHandoff } from "@/lib/checkout-handoff";

export async function POST(request: Request) {
  return handleCheckoutHandoff(request, "resolve");
}
