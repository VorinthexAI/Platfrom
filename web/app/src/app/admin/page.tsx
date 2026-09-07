import type { Metadata } from "next";

import { PRIVATE_ROUTE_METADATA } from "@/lib/private-route-metadata";
import { AdminClient } from "./AdminClient";

export const metadata: Metadata = {
  title: "Founder administration",
  ...PRIVATE_ROUTE_METADATA,
};

export default function AdminPage() {
  return <AdminClient />;
}
