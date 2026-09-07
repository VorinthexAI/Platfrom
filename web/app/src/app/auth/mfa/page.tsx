import type { Metadata } from "next";

import { PRIVATE_ROUTE_METADATA } from "@/lib/private-route-metadata";
import { MfaClient } from "./MfaClient";

export const metadata: Metadata = {
  title: "Team authentication",
  ...PRIVATE_ROUTE_METADATA,
};

export default function MfaPage() {
  return <MfaClient />;
}
