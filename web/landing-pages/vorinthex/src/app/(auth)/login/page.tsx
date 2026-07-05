import type { Metadata } from "next";

import { SignInForm } from "../signin/signin-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  return <SignInForm enrolled={params.enrolled === "1"} />;
}
