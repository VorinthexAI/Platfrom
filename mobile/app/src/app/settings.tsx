import { useLocalSearchParams, useRouter } from "expo-router";

import { AccountScreen } from "@/components/AccountScreen";
import { referralSettingsInitialState } from "@/lib/settings-route-params";

export default function SettingsRoute() {
  const router = useRouter();
  const initialState = referralSettingsInitialState(useLocalSearchParams<{ sheet?: string; mode?: string }>());
  return <AccountScreen initialState={initialState} onReferralSheetClose={() => router.setParams({ sheet: undefined, mode: undefined })} page="settings" />;
}
