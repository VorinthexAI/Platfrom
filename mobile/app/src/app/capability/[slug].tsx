import { Redirect } from "expo-router";

import { HOME_HREF } from "@/lib/deep-links";

export default function CapabilityRoute() {
  return <Redirect href={HOME_HREF} />;
}
