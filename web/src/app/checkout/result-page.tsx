import Link from "next/link";

import { Card } from "@vorinthex/shared/ui";

type CheckoutResultPageProps = {
  detail: string;
  eyebrow: string;
  primaryHref: string;
  primaryLabel: string;
  title: string;
};

export function CheckoutResultPage({
  detail,
  eyebrow,
  primaryHref,
  primaryLabel,
  title,
}: CheckoutResultPageProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16 text-foreground sm:px-6 sm:py-24">
      <div aria-hidden="true" className="vui-grid-field absolute inset-0" />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/70"
      />
      <Card className="relative z-10 w-full max-w-xl overflow-hidden px-6 py-7 sm:px-8 sm:py-9">
        <div>
          <p className="vui-label">{eyebrow}</p>
          <h1 className="mt-2 text-[2.15rem] font-normal leading-tight text-balance sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted sm:text-base sm:leading-7">
            {detail}
          </p>
        </div>

        <div className="mt-7">
          <Link className="vui-button vui-button-primary w-full" href={primaryHref}>
            {primaryLabel}
          </Link>
        </div>
      </Card>
    </main>
  );
}
