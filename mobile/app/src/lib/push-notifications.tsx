import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useEffectEvent } from "react";
import { AppState, Platform } from "react-native";

import { apiClient } from "./api-client";
import { communicationQueryKeys } from "./communication-client";
import { isPushPermissionAllowed, pushNotificationDataSchema, pushNotificationHref } from "./notification-policy";
import { useAuthStore } from "@/state/auth";

const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false }),
});

type PushSyncState = {
  userKey: string;
  controller: AbortController;
  pendingToken?: Notifications.DevicePushToken;
  registeredToken?: string;
  promise?: Promise<void>;
};
let pushSync: PushSyncState | undefined;

function resetPushSync() {
  pushSync?.controller.abort();
  pushSync = undefined;
}

function isCurrentSync(state: PushSyncState) {
  const auth = useAuthStore.getState();
  return !state.controller.signal.aborted && auth.status === "authenticated" && auth.user?.key === state.userKey;
}

const deviceTokenKey = (token: Notifications.DevicePushToken) => JSON.stringify([token.type, token.data]);

async function synchronizePushSubscription(state: PushSyncState) {
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { importance: Notifications.AndroidImportance.DEFAULT, name: "Notifications" });
  const permission = await Notifications.getPermissionsAsync();
  const iosStatus = permission.ios?.status;
  const allowed = isPushPermissionAllowed(permission.granted, iosStatus, [Notifications.IosAuthorizationStatus.AUTHORIZED, Notifications.IosAuthorizationStatus.PROVISIONAL, Notifications.IosAuthorizationStatus.EPHEMERAL]);
  if (!allowed || !isCurrentSync(state)) return;
  do {
    // Native token reads also emit token events on Android and iOS. Consume the
    // supplied token instead of starting another native registration from the listener.
    const devicePushToken = state.pendingToken ?? await Notifications.getDevicePushTokenAsync();
    const key = deviceTokenKey(devicePushToken);
    if (state.pendingToken && deviceTokenKey(state.pendingToken) === key) state.pendingToken = undefined;
    if (!isCurrentSync(state)) return;
    if (state.registeredToken !== key) {
      const token = (await Notifications.getExpoPushTokenAsync({ projectId, devicePushToken })).data;
      if (!isCurrentSync(state)) return;
      await apiClient.put("/auth/me/push-subscription", { token, projectId, platform: Platform.OS }, { signal: state.controller.signal });
      if (!isCurrentSync(state)) return;
      state.registeredToken = key;
    }
  } while (state.pendingToken && isCurrentSync(state));
}

export function syncPushSubscription(devicePushToken?: Notifications.DevicePushToken): Promise<void> {
  const auth = useAuthStore.getState();
  if (!projectId || Platform.OS === "web" || auth.status !== "authenticated" || !auth.user?.key) return Promise.resolve();
  if (pushSync?.userKey !== auth.user.key) {
    resetPushSync();
    pushSync = { userKey: auth.user.key, controller: new AbortController() };
  }
  const state = pushSync;
  if (devicePushToken) state.pendingToken = devicePushToken;
  // Coalesce startup, foreground, and native token events into one registration.
  // A failed attempt remains retryable on the next foreground/token event.
  state.promise ??= synchronizePushSubscription(state).finally(() => { state.promise = undefined; });
  return state.promise;
}

export async function unregisterPushSubscription() {
  resetPushSync();
  if (Platform.OS !== "web") await apiClient.delete("/auth/me/push-subscription", { data: {} });
}

export function PushNotificationBridge() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useAuthStore((state) => state.status);
  const userKey = useAuthStore((state) => String(state.user?.key ?? ""));
  const teamKey = useAuthStore((state) => String(state.team?.key ?? ""));
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const sync = useEffectEvent((token?: Notifications.DevicePushToken) => { void syncPushSubscription(token).catch(() => undefined); });
  const receive = useEffectEvent(() => { if (userKey && teamKey && scopeKey) void queryClient.invalidateQueries({ queryKey: communicationQueryKeys.all({ userKey, teamKey, scopeKey }) }); });
  const open = useEffectEvent((response: Notifications.NotificationResponse) => {
    const parsed = pushNotificationDataSchema.safeParse(response.notification.request.content.data);
    if (!parsed.success) return;
    receive();
    const href = pushNotificationHref(parsed.data);
    if (href && useAuthStore.getState().status === "authenticated") router.push(href);
  });

  useEffect(() => {
    if (status !== "authenticated") return;
    sync();
    const appState = AppState.addEventListener("change", (state) => { if (state === "active") sync(); });
    const token = Notifications.addPushTokenListener((devicePushToken) => sync(devicePushToken));
    const received = Notifications.addNotificationReceivedListener(receive);
    const response = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then((last) => { if (last) { open(last); void Notifications.clearLastNotificationResponseAsync(); } }).catch(() => undefined);
    return () => { resetPushSync(); appState.remove(); token.remove(); received.remove(); response.remove(); };
  }, [status, userKey]);

  return null;
}
