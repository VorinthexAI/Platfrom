import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@vorinthex/shared/ui/button";
import { Spinner } from "@vorinthex/shared/ui/spinner";
import { useToast } from "@vorinthex/shared/ui/toast";
import { useQueryClient } from "@tanstack/react-query";

import { activateGalleryShare, fetchGalleryOverview, getGalleryContext } from "@/lib/gallery-client";
import { clearPendingReturnRoute } from "@/lib/pending-return-route";
import { galleryQueryKeys, setCachedGalleryCollections } from "@/lib/workspace-query-cache";
import { useAuthStore } from "@/state/auth";
import { useAppsStore } from "@/state/apps";
import { fonts, palette, spacing } from "@/theme/tokens";

export default function GalleryShareActivationRoute() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const status = useAuthStore((state) => state.status);
  const isOnboarded = useAuthStore((state) => state.user?.isOnboarded === true);
  const processing = useRef<string | undefined>(undefined);
  const [error, setError] = useState<string>();
  const enterWorkspace = useAppsStore((state) => state.enterWorkspace);
  useLayoutEffect(() => enterWorkspace("gallery"), [enterWorkspace]);

  const activate = () => {
    if (!token || status !== "authenticated" || !isOnboarded || processing.current === token) return;
    processing.current = token;
    setError(undefined);
    void activateGalleryShare(token).then(async (activation) => {
      const context = getGalleryContext();
      if (activation.scopeKey !== context.scopeKey) throw new Error("This share belongs to a different Gallery workspace.");
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.all(context), refetchType: "none" });
      const overview = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(context), queryFn: () => fetchGalleryOverview(), staleTime: 0 });
      setCachedGalleryCollections(queryClient, context, overview.collections);
      await clearPendingReturnRoute().catch(() => undefined);
      showToast({ title: "Shared collection added", duration: 2_000 });
      router.replace({ pathname: "/capability/[slug]", params: { slug: "gallery" } });
    }).catch((failure: unknown) => {
      processing.current = undefined;
      setError(failure instanceof Error ? failure.message : "This share link could not be activated.");
    });
  };
  const close = () => {
    void clearPendingReturnRoute().finally(() => router.replace({ pathname: "/capability/[slug]", params: { slug: "gallery" } }));
  };

  useEffect(activate, [isOnboarded, status, token]);

  return <View style={styles.root}>
    {error ? <><Text accessibilityLiveRegion="polite" style={styles.message}>{error}</Text><Button onPress={activate} size="lg" variant="primary">Try again</Button><Button onPress={close} size="lg" variant="secondary">Close</Button></> : token ? <><Spinner accessibilityLabel="Activating Gallery share" size="small" /><Text style={styles.message}>Adding shared collection...</Text></> : <><Text style={styles.message}>This share link is incomplete.</Text><Button onPress={close} size="lg" variant="secondary">Close</Button></>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.xl, alignItems: "center", justifyContent: "center", gap: spacing.md, backgroundColor: palette.page },
  message: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, textAlign: "center" },
});
