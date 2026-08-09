import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { getJson, postJson } from "./api-client";

export type OAuthProvider = "google" | "apple";

type OAuthStart = { authorization_url: string };

export async function launchOAuthProvider(provider: OAuthProvider) {
  const redirectUri = Linking.createURL("/auth/oauth-complete");
  const query = new URLSearchParams({ redirect_uri: redirectUri });
  const start = await getJson<OAuthStart>(`/auth/mobile/oauth/${provider}?${query}`);
  const result = await WebBrowser.openAuthSessionAsync(start.authorization_url, redirectUri);
  if (result.type !== "success") return false;

  const callback = Linking.parse(result.url).queryParams ?? {};
  const code = typeof callback.code === "string" ? callback.code : null;
  const providerError = typeof callback.error === "string" ? callback.error : null;
  if (providerError) throw new Error("Additional verification is required before this account can sign in.");
  if (!code) throw new Error("The identity provider returned an incomplete sign-in response.");
  await postJson("/auth/mobile/oauth/exchange", { code });
  return true;
}
