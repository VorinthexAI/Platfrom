import { JsonLd } from "@/components/site/JsonLd";
import { CorePage } from "@/components/core/CorePage";
import { buildRouteMetadata } from "@/lib/metadata";
import { buildPageGraph } from "@/lib/structured-data";

export const metadata = buildRouteMetadata("/");

export default function Home() {
  return (
    <>
      <JsonLd data={buildPageGraph("/")} />
      <CorePage />
    </>
  );
}
