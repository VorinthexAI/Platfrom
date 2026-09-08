import { useRouter } from "expo-router";
import { NotificationsSheet } from "@/components/NotificationsSheet";

export default function NotificationsRoute() {
  const router = useRouter();
  const close = () => { if (router.canGoBack()) router.back(); else router.replace("/profile"); };
  return <NotificationsSheet onClose={close} open />;
}
