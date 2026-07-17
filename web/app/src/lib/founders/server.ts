import "server-only";

import { cookies } from "next/headers";

/**
 * Founders Gate route handlers forward the httpOnly session cookie to the
 * backend as a bearer token. The backend re-resolves the user and enforces
 * root-organization, organization, and scope access on its own — these
 * handlers are a transport bridge, never an authorization layer.
 */
export async function foundersAuthHeaders(): Promise<Record<string, string>> {
  const accessToken = (await cookies()).get("vorinthex_access")?.value;
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}
