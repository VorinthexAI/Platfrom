import {
  Geist_300Light,
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  useFonts,
} from "@expo-google-fonts/geist";
import { Stack, useRouter, useSegments, type Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppQueryProvider } from "@/lib/query-client";
import { useAuthStore } from "@/state/auth";
import { palette } from "@/theme/tokens";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Geist_300Light,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
  });
  const status = useAuthStore((state) => state.status);
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if ((fontsLoaded || fontError) && status !== "bootstrapping") {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontError, fontsLoaded, status]);

  useEffect(() => {
    if (status === "bootstrapping") return;
    const root = segments[0] as string | undefined;
    const isPublic = root === "auth" || root === "public" || root === undefined;
    if (status === "unauthenticated" && !isPublic) router.replace("/auth" as Href);
    if (status === "authenticated" && root === "auth") router.replace("/onboarding");
  }, [router, segments, status]);

  if ((!fontsLoaded && !fontError) || status === "bootstrapping") {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.page }}>
      <SafeAreaProvider>
        <AppQueryProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: palette.page },
              animation: "fade",
            }}
          />
        </AppQueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
