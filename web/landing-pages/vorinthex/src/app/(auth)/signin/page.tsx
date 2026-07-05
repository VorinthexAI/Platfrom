import type { Metadata } from "next";

import { SignInForm } from "./signin-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  return <SignInForm enrolled={params.enrolled === "1"} />;
}
