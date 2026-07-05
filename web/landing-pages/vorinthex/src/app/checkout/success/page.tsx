import type { Metadata } from "next";

import { CheckoutResultPage } from "../result-page";

export const metadata: Metadata = {
  title: "Checkout complete",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await searchParams;

  return (
    <CheckoutResultPage
      detail="Your private beta ticket is confirmed. Keep an eye on your inbox for the receipt and the next private access update."
      eyebrow="Payment complete"
      primaryHref="/"
      primaryLabel="Return to Vorinthex AI"
      title="You are secured for private beta pricing."
    />
  );
}
