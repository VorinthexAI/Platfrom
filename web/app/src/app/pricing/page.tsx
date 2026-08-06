import { JsonLd } from "@/components/site/JsonLd";
import { PricingPage } from "@/components/pricing/PricingPage";
import { buildRouteMetadata } from "@/lib/metadata";
import { buildPageGraph } from "@/lib/structured-data";

export const metadata = buildRouteMetadata("/pricing");

export default function PricingPageRoute() {
  return (
    <>
      <JsonLd data={buildPageGraph("/pricing")} />
      <PricingPage />
    </>
  );
}
