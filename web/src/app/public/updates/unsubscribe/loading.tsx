import { Card } from "@/shared/packages/ui";

export default function UpdatesUnsubscribeLoading() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16 text-foreground sm:py-24">
      <div aria-hidden="true" className="vui-grid-field absolute inset-0" />
      <Card className="relative z-10 w-full max-w-md">
        <p className="vui-label">Email preferences</p>
        <h1 className="mt-2 text-3xl font-normal">Updating preferences...</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          We are processing your unsubscribe request.
        </p>
      </Card>
    </main>
  );
}
