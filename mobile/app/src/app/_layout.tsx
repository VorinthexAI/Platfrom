import {
  Geist_300Light,
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  useFonts,
} from "@expo-google-fonts/geist";
import { Stack, usePathname, useRouter, useSegments, type Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { BottomSheetScene } from "@vorinthex/shared/ui/bottom-sheet";
import { ToastProvider } from "@vorinthex/shared/ui/toast";
import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppQueryProvider } from "@/lib/query-client";
import { trackAppOpened } from "@/lib/analytics";
import { useAuthStore } from "@/state/auth";
import { useOnboardingStore } from "@/state/onboarding";
import { palette } from "@/theme/tokens";
import { readPendingReturnRoute, savePendingReturnRoute } from "@/lib/pending-return-route";

SplashScreen.preventAutoHideAsync().catch(() => {});
let appOpenedTracked = false;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Geist_300Light,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
  });
  const status = useAuthStore((state) => state.status);
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const userKey = useAuthStore((state) => state.user?.key);
  const hydrateOnboarding = useOnboardingStore((state) => state.hydrate);
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();

  useEffect(() => {
    void bootstrap().finally(() => {
      if (!appOpenedTracked) {
        appOpenedTracked = true;
        void trackAppOpened().catch(() => undefined);
      }
    });
  }, [bootstrap]);

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
    if (status === "unauthenticated" && root === "share") {
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
  }, [pathname, router, segments, status]);

  useEffect(() => {
    if (Platform.OS !== "android" || !pathname.startsWith("/capability/")) return;
    return BackHandler.addEventListener("hardwareBackPress", () => {
      if (pathname !== "/capability/archive") router.replace("/capability/archive");
      return true;
    }).remove;
  }, [pathname, router]);

  if ((!fontsLoaded && !fontError) || status === "bootstrapping") {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.page }}>
      <SafeAreaProvider>
        <AppQueryProvider>
          <ToastProvider>
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
          </ToastProvider>
        </AppQueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
