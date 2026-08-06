import { JsonLd } from "@/components/site/JsonLd";
import { LegalPage } from "@/components/legal/LegalPage";
import { PRIVACY_COPY } from "@/lib/legal-copy";
import { buildRouteMetadata } from "@/lib/metadata";
import { buildPageGraph } from "@/lib/structured-data";

export const metadata = buildRouteMetadata("/privacy");

export default function PrivacyPage() {
  return (
    <>
      <JsonLd data={buildPageGraph("/privacy")} />
      <LegalPage copy={PRIVACY_COPY} />
    </>
  );
}
