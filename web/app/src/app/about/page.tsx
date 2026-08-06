import { JsonLd } from "@/components/site/JsonLd";
import { AboutPage } from "@/components/about/AboutPage";
import { buildRouteMetadata } from "@/lib/metadata";
import { buildPageGraph } from "@/lib/structured-data";

export const metadata = buildRouteMetadata("/about");

export default function AboutPageRoute() {
  return (
    <>
      <JsonLd data={buildPageGraph("/about")} />
      <AboutPage />
    </>
  );
}
