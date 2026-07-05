import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Verify it's you",
};

export default function LoginVerifyPage() {
  redirect("/signin");
}
