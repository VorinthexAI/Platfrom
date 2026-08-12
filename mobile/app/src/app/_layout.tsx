import {
  Geist_300Light,
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  useFonts,
} from "@expo-google-fonts/geist";
import { Stack, useRouter, useSegments, type Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { BottomSheetScene } from "@vorinthex/shared/ui/bottom-sheet";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppQueryProvider } from "@/lib/query-client";
import { trackAppOpened } from "@/lib/analytics";
import { useAuthStore } from "@/state/auth";
import { useOnboardingStore } from "@/state/onboarding";
import { palette } from "@/theme/tokens";

SplashScreen.preventAutoHideAsync().catch(() => {});
let appOpenedTracked = false;
const SESSION_RESET_KEY = "vorinthex.auth.startup-reset.2026-08-11";
let sessionResetOperation: Promise<void> | undefined;

function clearPriorSessionOnce(signOut: () => Promise<void>) {
  sessionResetOperation ??= (async () => {
    if (await SecureStore.getItemAsync(SESSION_RESET_KEY)) return;
    await signOut();
    await SecureStore.setItemAsync(SESSION_RESET_KEY, "complete", {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  })();
  return sessionResetOperation;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Geist_300Light,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
  });
  const status = useAuthStore((state) => state.status);
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const signOut = useAuthStore((state) => state.signOut);
  const userKey = useAuthStore((state) => state.user?.key);
  const hydrateOnboarding = useOnboardingStore((state) => state.hydrate);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    void clearPriorSessionOnce(signOut).then(bootstrap).finally(() => {
      if (!appOpenedTracked) {
        appOpenedTracked = true;
        void trackAppOpened().catch(() => undefined);
      }
    });
  }, [bootstrap, signOut]);

  useEffect(() => {
    if (status === "authenticated" && userKey) void hydrateOnboarding(userKey);
  }, [hydrateOnboarding, status, userKey]);

  useEffect(() => {
    if ((fontsLoaded || fontError) && status !== "bootstrapping") {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontError, fontsLoaded, status]);

  useEffect(() => {
    if (status === "bootstrapping") return;
    const root = segments[0] as string | undefined;
    const isPublic = root === "auth" || root === "public" || root === undefined;
    const isOnboarded = useAuthStore.getState().user?.isOnboarded === true;
    if (status === "unauthenticated" && !isPublic) router.replace("/auth" as Href);
    if (status === "authenticated" && root === "auth") router.replace(isOnboarded ? "/capability/archive" : "/onboarding");
    if (status === "authenticated" && root === "public") router.replace(isOnboarded ? "/capability/archive" : "/onboarding");
    if (status === "authenticated" && !isOnboarded && !isPublic && root !== "onboarding") router.replace("/onboarding");
    if (status === "authenticated" && isOnboarded && root === "onboarding") router.replace("/capability/archive");
  }, [router, segments, status]);

  if ((!fontsLoaded && !fontError) || status === "bootstrapping") {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.page }}>
      <SafeAreaProvider>
        <AppQueryProvider>
          <BottomSheetScene>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: palette.page },
                animation: "fade",
              }}
            />
          </BottomSheetScene>
        </AppQueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
