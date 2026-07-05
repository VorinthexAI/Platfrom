import type { Metadata } from "next";

import { SignInForm } from "./signin-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function SignInPage() {
  return <SignInForm />;
}
