import { LandingPage } from "@/components/landing/LandingPage";

export const metadata = {
  title: "Sign in complete",
  robots: { index: false, follow: false },
};

export default function OAuthCallbackPage() {
  return <LandingPage initialCave="oauth-callback" />;
}
