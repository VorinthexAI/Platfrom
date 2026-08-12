import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import { getJson, postJson } from "./api-client";

export type OAuthProvider = "google" | "apple";

type OAuthStart = { authorization_url: string };
const MOBILE_OAUTH_REDIRECT_URI = "vorinthexcore://auth/oauth-complete";
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const PENDING_APPLE_NAME_KEY = "vorinthex.auth.apple-name.v1";

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

  if (provider === "apple" && Platform.OS === "ios") {
    if (!await AppleAuthentication.isAvailableAsync()) throw new Error("Apple sign in is unavailable on this device.");
    const nonce = Crypto.randomUUID();
    const state = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
    try {
      const credential = await AppleAuthentication.signInAsync({
        nonce: hashedNonce,
        state,
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (credential.state !== state || !credential.identityToken) {
        throw new Error("Apple returned an incomplete sign-in response.");
      }
      const providedName = credential.fullName ? AppleAuthentication.formatFullName(credential.fullName).trim() : "";
      if (providedName) {
        await SecureStore.setItemAsync(PENDING_APPLE_NAME_KEY, JSON.stringify({ user: credential.user, name: providedName }), {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      }
      const pendingName = await SecureStore.getItemAsync(PENDING_APPLE_NAME_KEY).then((value) => {
        if (!value) return "";
        try {
          const parsed = JSON.parse(value) as { user?: unknown; name?: unknown };
          return parsed.user === credential.user && typeof parsed.name === "string" ? parsed.name : "";
        } catch {
          return "";
        }
      });
      await postJson<{ id_token: string; nonce: string; name?: string }, unknown>("/auth/mobile/apple", {
        id_token: credential.identityToken,
        nonce,
        ...(pendingName ? { name: pendingName } : {}),
      });
      await SecureStore.deleteItemAsync(PENDING_APPLE_NAME_KEY);
      return true;
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "ERR_REQUEST_CANCELED") return false;
      throw error;
    }
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
