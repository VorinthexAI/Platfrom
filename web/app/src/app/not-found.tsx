import Link from "next/link";

export default function NotFound() {
  return (
    <main className="obsidian-noise flex min-h-svh flex-col items-center justify-center px-5 text-center">
      <p className="micro-label">Lost in space</p>
      <h1 className="font-display mt-6 text-5xl tracking-[0.16em] text-silver-50 uppercase">
        404
      </h1>
      <p className="mt-6 max-w-sm text-sm leading-relaxed text-silver-500">
        This coordinate does not exist in the Nexus. Return to the galaxy
        overview.
      </p>
      <Link href="/" className="vui-button vui-button-secondary mt-10 min-h-0 px-7 py-3 text-xs uppercase">
        Back to overview
      </Link>
    </main>
  );
}
