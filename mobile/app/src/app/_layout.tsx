import {
  Geist_300Light,
  useFonts,
} from "@expo-google-fonts/geist";
import { Stack, useRouter, useSegments, type Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { BottomSheetScene } from "@vorinthex/shared/ui/bottom-sheet";
import { ToastProvider } from "@vorinthex/shared/ui/toast";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppQueryProvider } from "@/lib/query-client";
import { useAuthStore } from "@/state/auth";
import { palette } from "@/theme/tokens";
import { BookPlaybackProvider } from "@/lib/book-playback";
import { useAppsStore } from "@/state/apps";
import { useInternetConnection } from "@/hooks/use-internet-connection";
import { AppAvailabilitySheets } from "@/components/AppAvailabilitySheets";
import { SparksBalanceSheet } from "@/components/SparksBalanceSheet";
import { PaywallSheet } from "@/components/PaywallSheet";
import { readLocalOnboardingState, subscribeLocalOnboardingState, type LocalOnboardingState } from "@/lib/onboarding-state";

const APP_BOOTSTRAP_RETRY_MS = 1_000;
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Geist_300Light,
    Geist_400Regular: Geist_300Light,
    Geist_500Medium: Geist_300Light,
    Geist_600SemiBold: Geist_300Light,
  });
  const status = useAuthStore((state) => state.status);
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const [localOnboarding, setLocalOnboarding] = useState<LocalOnboardingState>();
  const appsStatus = useAppsStore((state) => state.bootstrapStatus);
  const bootstrapApps = useAppsStore((state) => state.bootstrap);
  const router = useRouter();
  const segments = useSegments();
  const { isOffline, isResolved: connectionResolved } = useInternetConnection();

  useEffect(() => {
    const unsubscribe = subscribeLocalOnboardingState(setLocalOnboarding);
    void readLocalOnboardingState().catch(() => setLocalOnboarding({ complete: false, previewComplete: false }));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (connectionResolved && !isOffline) void bootstrapApps();
  }, [bootstrapApps, connectionResolved, isOffline]);

  useEffect(() => {
    if (appsStatus === "ready") void bootstrap();
  }, [appsStatus, bootstrap]);

  useEffect(() => {
    if (appsStatus !== "failed" || isOffline) return;
    const retry = setTimeout(() => void bootstrapApps(), APP_BOOTSTRAP_RETRY_MS);
    return () => clearTimeout(retry);
  }, [appsStatus, bootstrapApps, isOffline]);

  useEffect(() => {
    if (localOnboarding && (fontsLoaded || fontError) && (isOffline || (status !== "bootstrapping" && appsStatus === "ready"))) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [appsStatus, fontError, fontsLoaded, isOffline, localOnboarding, status]);

  useEffect(() => {
    if (status === "bootstrapping" || appsStatus !== "ready" || !localOnboarding) return;
    const root = segments[0] as string | undefined;
    const isPublic = root === "auth" || root === "public" || root === "referral" || root === "checkout" || root === undefined;
    const isOnboarded = useAuthStore.getState().user?.isOnboarded === true;
    if (status === "unauthenticated") {
      if (!localOnboarding.complete && !localOnboarding.previewComplete) {
        if (root === "auth" || root === undefined || (!isPublic && root !== "onboarding")) router.replace("/onboarding");
      } else if (root === undefined || (!isPublic && root !== "auth")) router.replace("/auth" as Href);
      return;
    }
    if (status === "authenticated" && (root === "auth" || root === "public")) {
      if (!isOnboarded) router.replace("/onboarding");
      else router.replace("/capability/archive");
    }
    if (status === "authenticated" && !isOnboarded && !isPublic && root !== "onboarding") router.replace("/onboarding");
  }, [appsStatus, localOnboarding, router, segments, status]);

  if ((!fontsLoaded && !fontError) || !connectionResolved || !localOnboarding || (!isOffline && (status === "bootstrapping" || appsStatus !== "ready"))) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.page }}>
      <SafeAreaProvider>
        <AppQueryProvider>
          <ToastProvider>
            <BottomSheetScene>
              <BookPlaybackProvider>
                <StatusBar style="light" />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: palette.page },
                    animation: "slide_from_right",
                  }}
                />
                <AppAvailabilitySheets isOffline={isOffline} />
                <SparksBalanceSheet isOffline={isOffline} />
                <PaywallSheet />
              </BookPlaybackProvider>
            </BottomSheetScene>
          </ToastProvider>
        </AppQueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
