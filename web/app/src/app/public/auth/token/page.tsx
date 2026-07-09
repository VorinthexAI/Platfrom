import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Complete your Vorinthex sign-in.",
  robots: { index: false, follow: false },
};

interface AuthTokenPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Magic-link deep link (?token_hash=…&flow=…).
 *
 * Explorer links (flow=user) travel into the solar system, validate in the
 * background, and hyper-jump straight to the public galaxy — the same
 * arrival as email verification. Legacy member links (flow=member) dive
 * into the Cipher Chamber for TOTP setup/verification, then surf into
 * /galaxy/sun — new platform links land on /auth/mfa instead.
 */
export default async function AuthTokenPage({ searchParams }: AuthTokenPageProps) {
  const params = await searchParams;
  const flow = typeof params.flow === "string" ? params.flow : "member";
  if (flow === "user") {
    return <LandingPage arrival="magic" />;
  }
  return <LandingPage initialCave="magic" />;
}
