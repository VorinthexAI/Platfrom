import Link from "next/link";

import { Card } from "@/shared/packages/ui";

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16 text-foreground sm:px-6 sm:py-24">
      <div aria-hidden="true" className="vui-grid-field absolute inset-0" />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/70"
      />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/50"
      />

      <Card className="relative z-10 w-full max-w-2xl overflow-hidden px-6 py-7 sm:px-9 sm:py-10">
        <div className="flex flex-col gap-7 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="vui-label">404</p>
            <h1 className="mt-3 max-w-xl text-[2.45rem] font-normal leading-none text-balance sm:text-6xl">
              This page drifted off course.
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-6 text-muted sm:text-base sm:leading-7">
              The route you opened does not exist, or it moved while the app was
              being updated. Head back to the landing page to continue.
            </p>
          </div>

          <div className="shrink-0 border border-border bg-background px-4 py-3 text-right">
            <span className="block text-4xl font-light leading-none">0</span>
            <span className="mt-1 block text-[10px] uppercase tracking-[0.18em] text-muted">
              route found
            </span>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link className="vui-button vui-button-primary" href="/">
            Return to landing page
          </Link>
          <Link className="vui-button vui-button-secondary" href="/login">
            Sign in
          </Link>
        </div>
      </Card>
    </main>
  );
}
