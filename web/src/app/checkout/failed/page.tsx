import type { Metadata } from "next";

import { CheckoutResultPage } from "../result-page";

export const metadata: Metadata = {
  title: "Checkout failed",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CheckoutFailedPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await searchParams;

  return (
    <CheckoutResultPage
      detail="The payment did not complete. Your waitlist position is unchanged, and you can retry the ticket checkout when you are ready."
      eyebrow="Checkout issue"
      primaryHref="/"
      primaryLabel="Return to Vorinthex AI"
      title="The ticket was not reserved."
    />
  );
}
