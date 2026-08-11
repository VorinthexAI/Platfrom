import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import { getJson, postJson } from "./api-client";

export type OAuthProvider = "google" | "apple";

type OAuthStart = { authorization_url: string };
const MOBILE_OAUTH_REDIRECT_URI = "vorinthexcore://auth/oauth-complete";
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

const exchangeOperations = new Map<string, Promise<void>>();

export function exchangeOAuthCode(code: string) {
  const existing = exchangeOperations.get(code);
  if (existing) return existing;

  const operation = postJson<{ code: string }, unknown>("/auth/mobile/oauth/exchange", { code })
    .then(() => undefined)
    .catch((error: unknown) => {
      exchangeOperations.delete(code);
      throw error;
    });
  exchangeOperations.set(code, operation);
  return operation;
}

export async function launchOAuthProvider(provider: OAuthProvider) {
  if (provider === "google" && Platform.OS === "android") {
    if (!GOOGLE_WEB_CLIENT_ID) throw new Error("Google sign in is not configured.");
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    await GoogleSignin.signOut().catch(() => null);
    const response = await GoogleSignin.signIn();
    if (response.type !== "success") return false;
    if (!response.data.idToken) throw new Error("Google returned an incomplete sign-in response.");
    await postJson<{ id_token: string }, unknown>("/auth/mobile/google", { id_token: response.data.idToken });
    return true;
  }

  const query = new URLSearchParams({ redirect_uri: MOBILE_OAUTH_REDIRECT_URI });
  const start = await getJson<OAuthStart>(`/auth/mobile/oauth/${provider}?${query}`);
  const result = await WebBrowser.openAuthSessionAsync(start.authorization_url, MOBILE_OAUTH_REDIRECT_URI);
  if (result.type !== "success") return false;

  const callback = Linking.parse(result.url).queryParams ?? {};
  const code = typeof callback.code === "string" ? callback.code : null;
  const providerError = typeof callback.error === "string" ? callback.error : null;
  if (providerError) throw new Error("Additional verification is required before this account can sign in.");
  if (!code) throw new Error("The identity provider returned an incomplete sign-in response.");
  await exchangeOAuthCode(code);
  return true;
}
