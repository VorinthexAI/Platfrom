"use client";

import { useFragmentsStore } from "@/lib/fragments/fragments-store";
import { useGalaxyStore } from "@/lib/galaxy-store";

/**
 * Signs the explorer out everywhere the client can reach:
 * - expires the server auth + handoff cookies (the route keeps vx_explorer);
 * - clears the local session markers so no surface reads back in as authed;
 * - resets the fragments ledger (balance + joined) to its signed-out state;
 * - announces the change so `useAuthProfile` and every listener re-read;
 * - lands the camera back at the Nexus overview (a plain reset, no jump).
 */
export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/signout", { method: "POST" });
  } catch {
    // Even if the network call fails, still clear the local session so the
    // explorer isn't left looking signed in.
  }

  try {
    window.localStorage.removeItem("vx_profile");
    window.localStorage.removeItem("vx_member_email");
    window.localStorage.removeItem("vx_member_name");
    window.localStorage.removeItem("vx_member_title");
    window.localStorage.removeItem("vx_joined");
  } catch {
    // Storage may be blocked — nothing more to clear.
  }

  useFragmentsStore.setState({ balance: 0, hasJoined: false });
  window.dispatchEvent(new Event("vx-profile-changed"));
  useGalaxyStore.getState().resetToSystem();
}
