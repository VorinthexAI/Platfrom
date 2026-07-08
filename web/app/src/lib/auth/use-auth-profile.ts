"use client";

import { useEffect, useState } from "react";

/**
 * The signed-in explorer profile persisted to `localStorage["vx_profile"]`
 * by every sign-in surface (join verify, magic link, cross-device handoff).
 * Its mere presence means "signed in"; the fields are best-effort.
 */
export interface AuthProfile {
  email?: string | null;
  alias?: string | null;
  waitlistNumber?: number | null;
  welcomeLine?: string | null;
}

function readProfile(): AuthProfile | null {
  try {
    const raw = window.localStorage.getItem("vx_profile");
    if (!raw) return null;
    return JSON.parse(raw) as AuthProfile;
  } catch {
    return null;
  }
}

/**
 * Auth-awareness for client surfaces. SSR-safe: renders signed-out on the
 * server and the first client paint (so hydration matches), then reads
 * vx_profile in an effect and stays live by listening for `vx-profile-changed`
 * (same-tab writes) and `storage` (other tabs).
 */
export function useAuthProfile(): {
  profile: AuthProfile | null;
  signedIn: boolean;
} {
  const [profile, setProfile] = useState<AuthProfile | null>(null);

  useEffect(() => {
    const sync = () => setProfile(readProfile());
    sync();
    window.addEventListener("vx-profile-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("vx-profile-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return { profile, signedIn: profile !== null };
}
