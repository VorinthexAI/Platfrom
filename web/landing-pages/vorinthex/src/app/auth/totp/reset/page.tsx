import type { Metadata } from "next";

import { ResetTotpForm } from "./reset-totp-form";

export const metadata: Metadata = {
  title: "Reset authenticator",
  robots: {
    index: false,
    follow: false,
  },
};

export default function TotpResetPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16 text-foreground sm:py-24">
      <div aria-hidden="true" className="vui-grid-field absolute inset-0" />
      <div className="relative z-10 w-full max-w-md">
        <ResetTotpForm />
      </div>
    </main>
  );
}
