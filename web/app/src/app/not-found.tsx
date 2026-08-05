import Link from "next/link";
import { Button } from "@vorinthex/shared/ui/components";

export default function NotFound() {
  return (
    <main className="obsidian-noise flex min-h-svh flex-col items-center justify-center px-5 text-center">
      <p className="micro-label">Page not found</p>
      <h1 className="font-display mt-6 text-5xl tracking-[0.16em] text-silver-50 uppercase">
        404
      </h1>
      <p className="mt-6 max-w-sm text-sm leading-relaxed text-silver-500">
        The page you requested is no longer available. Return to Vorinthex Core.
      </p>
      <Button asChild size="md" variant="secondary" className="mt-10">
        <Link href="/">Back to Core</Link>
      </Button>
    </main>
  );
}
