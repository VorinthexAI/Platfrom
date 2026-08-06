import { JsonLd } from "@/components/site/JsonLd";
import { LegalPage } from "@/components/legal/LegalPage";
import { TERMS_COPY } from "@/lib/legal-copy";
import { buildRouteMetadata } from "@/lib/metadata";
import { buildPageGraph } from "@/lib/structured-data";

export const metadata = buildRouteMetadata("/terms");

export default function TermsPage() {
  return (
    <>
      <JsonLd data={buildPageGraph("/terms")} />
      <LegalPage copy={TERMS_COPY} />
    </>
  );
}
