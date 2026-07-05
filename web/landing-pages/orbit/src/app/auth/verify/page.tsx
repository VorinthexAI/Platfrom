import Link from "next/link";
import { redirect } from "next/navigation";

import { Button, Card } from "@vorinthex/shared/ui";

import { validateMagicLinkAction } from "../../(auth)/auth-actions";

export default async function AuthVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tokenHash =
    typeof params.token_hash === "string" ? params.token_hash.trim() : "";

  const result = await validateMagicLinkAction(tokenHash);

  if (result.ok) {
    redirect("/console/home");
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md text-center">
        <p className="cui-label">Sign-in link</p>
        <h1 className="mt-2 text-3xl font-normal">That link didn&apos;t work.</h1>
        <p className="mt-3 text-sm leading-6 text-muted">{result.message}</p>
        <Button asChild className="mt-6 w-full" variant="secondary">
          <Link href="/signin">Back to sign in</Link>
        </Button>
      </Card>
    </div>
  );
}
