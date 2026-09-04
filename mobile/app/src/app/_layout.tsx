import {
  Geist_300Light,
  useFonts,
} from "@expo-google-fonts/geist";
import { Stack, usePathname, useRouter, useSegments, type Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { BottomSheetScene } from "@vorinthex/shared/ui/bottom-sheet";
import { ToastProvider } from "@vorinthex/shared/ui/toast";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppQueryProvider } from "@/lib/query-client";
import { useAuthStore } from "@/state/auth";
import { useOnboardingStore } from "@/state/onboarding";
import { palette } from "@/theme/tokens";
import { readPendingReturnRoute, savePendingReturnRoute } from "@/lib/pending-return-route";
import { BookPlaybackProvider } from "@/lib/book-playback";
import { useAppsStore } from "@/state/apps";
import { useInternetConnection } from "@/hooks/use-internet-connection";
import { AppAvailabilitySheets } from "@/components/AppAvailabilitySheets";
import { SparksBalanceSheet } from "@/components/SparksBalanceSheet";

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
  const appsStatus = useAppsStore((state) => state.bootstrapStatus);
  const bootstrapApps = useAppsStore((state) => state.bootstrap);
  const userKey = useAuthStore((state) => state.user?.key);
  const hydrateOnboarding = useOnboardingStore((state) => state.hydrate);
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const { isOffline, isResolved: connectionResolved } = useInternetConnection();

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
    if (status === "authenticated" && userKey) void hydrateOnboarding(userKey);
  }, [hydrateOnboarding, status, userKey]);

  useEffect(() => {
    if ((fontsLoaded || fontError) && (isOffline || (status !== "bootstrapping" && appsStatus === "ready"))) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [appsStatus, fontError, fontsLoaded, isOffline, status]);

  useEffect(() => {
    if (status === "bootstrapping" || appsStatus !== "ready") return;
    const root = segments[0] as string | undefined;
    const isPublicBookShare = root === "share" && (segments as readonly string[])[1] === "books";
    const isPublic = root === "auth" || root === "public" || isPublicBookShare || root === undefined;
    const isOnboarded = useAuthStore.getState().user?.isOnboarded === true;
    if (status === "unauthenticated" && root === "share" && !isPublicBookShare) {
      void savePendingReturnRoute(pathname).finally(() => router.replace({ pathname: "/auth", params: { returnTo: pathname } } as Href));
      return;
    }
    if (status === "unauthenticated" && !isPublic) router.replace("/auth" as Href);
    if (status === "authenticated" && (root === "auth" || root === "public")) {
      if (!isOnboarded) router.replace("/onboarding");
      else void readPendingReturnRoute().then((returnTo) => router.replace((returnTo ?? "/capability/archive") as Href)).catch(() => router.replace("/capability/archive"));
    }
    if (status === "authenticated" && !isOnboarded && !isPublic && root !== "onboarding") router.replace("/onboarding");
    if (status === "authenticated" && isOnboarded && root === "onboarding") router.replace("/capability/archive");
  }, [appsStatus, pathname, router, segments, status]);

  if ((!fontsLoaded && !fontError) || !connectionResolved || (!isOffline && (status === "bootstrapping" || appsStatus !== "ready"))) {
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
                    animation: "fade",
                  }}
                />
                <AppAvailabilitySheets isOffline={isOffline} />
                <SparksBalanceSheet isOffline={isOffline} />
              </BookPlaybackProvider>
            </BottomSheetScene>
          </ToastProvider>
        </AppQueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
