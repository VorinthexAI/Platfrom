import { JsonLd } from "@/components/site/JsonLd";
import { LegalPage } from "@/components/legal/LegalPage";
import { CONTACT_COPY } from "@/lib/legal-copy";
import { buildRouteMetadata } from "@/lib/metadata";
import { buildPageGraph } from "@/lib/structured-data";

export const metadata = buildRouteMetadata("/contact");

export default function ContactPage() {
  return (
    <>
      <JsonLd data={buildPageGraph("/contact")} />
      <LegalPage copy={CONTACT_COPY} />
    </>
  );
}
