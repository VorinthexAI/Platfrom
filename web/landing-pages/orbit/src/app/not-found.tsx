import Link from "next/link";

import { Button, Card } from "@vorinthex/shared/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md text-center">
        <p className="cui-label">404</p>
        <h1 className="mt-3 text-4xl font-normal">This page drifted off course.</h1>
        <p className="mt-4 text-sm leading-6 text-muted">
          The route you opened does not exist, or it moved.
        </p>
        <Button asChild className="mt-8 w-full" variant="primary">
          <Link href="/">Return home</Link>
        </Button>
      </Card>
    </main>
  );
}
