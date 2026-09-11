import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useEffectEvent } from "react";
import { AppState, Platform } from "react-native";

import { apiClient } from "./api-client";
import { communicationQueryKeys } from "./communication-client";
import { isPushPermissionAllowed, signalThreadPushDataSchema } from "./notification-policy";
import { useAuthStore } from "@/state/auth";

const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false }),
});

async function registerToken(token: string) {
  if (!projectId || Platform.OS === "web") return;
  await apiClient.put("/auth/me/push-subscription", { token, projectId, platform: Platform.OS });
}

export async function syncPushSubscription() {
  if (!projectId || Platform.OS === "web" || useAuthStore.getState().status !== "authenticated") return;
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { importance: Notifications.AndroidImportance.DEFAULT, name: "Notifications" });
  const permission = await Notifications.getPermissionsAsync();
  const iosStatus = permission.ios?.status;
  const allowed = isPushPermissionAllowed(permission.granted, iosStatus, [Notifications.IosAuthorizationStatus.AUTHORIZED, Notifications.IosAuthorizationStatus.PROVISIONAL, Notifications.IosAuthorizationStatus.EPHEMERAL]);
  if (!allowed) return;
  await registerToken((await Notifications.getExpoPushTokenAsync({ projectId })).data);
}

export async function unregisterPushSubscription() {
  if (Platform.OS !== "web") await apiClient.delete("/auth/me/push-subscription", { data: {} });
}

export function PushNotificationBridge() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useAuthStore((state) => state.status);
  const userKey = useAuthStore((state) => String(state.user?.key ?? ""));
  const teamKey = useAuthStore((state) => String(state.team?.key ?? ""));
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const sync = useEffectEvent(() => { void syncPushSubscription().catch(() => undefined); });
  const receive = useEffectEvent(() => { if (userKey && teamKey && scopeKey) void queryClient.invalidateQueries({ queryKey: communicationQueryKeys.all({ userKey, teamKey, scopeKey }) }); });
  const open = useEffectEvent((response: Notifications.NotificationResponse) => {
    const parsed = signalThreadPushDataSchema.safeParse(response.notification.request.content.data);
    if (!parsed.success) return;
    receive();
    if (useAuthStore.getState().status === "authenticated") router.push({ pathname: "/capability/[slug]", params: { slug: "signal", tab: "inbox", inbox: "internal", thread: parsed.data.signalThreadKey } });
  });

  useEffect(() => {
    if (status !== "authenticated") return;
    sync();
    const appState = AppState.addEventListener("change", (state) => { if (state === "active") sync(); });
    const token = Notifications.addPushTokenListener(() => sync());
    const received = Notifications.addNotificationReceivedListener(receive);
    const response = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then((last) => { if (last) { open(last); void Notifications.clearLastNotificationResponseAsync(); } }).catch(() => undefined);
    return () => { appState.remove(); token.remove(); received.remove(); response.remove(); };
  }, [status]);

  return null;
}
