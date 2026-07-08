import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * `/signin` is a legacy alias. Auth now lives under the canonical `/auth`
 * route, so this permanently redirects (HTTP 308) and keeps old links alive.
 */
export default function SignInPage() {
  permanentRedirect("/auth");
}
