import { JsonLd } from "@/components/site/JsonLd";
import { KnowledgeWorkspace } from "@/components/knowledge/KnowledgeWorkspace";
import { buildRouteMetadata } from "@/lib/metadata";
import { buildPageGraph } from "@/lib/structured-data";
import { CORE_CAPABILITIES } from "@/lib/discoverability";

export const metadata = buildRouteMetadata("/");

export default function Home() {
  return (
    <>
      <JsonLd data={buildPageGraph("/")} />
      <KnowledgeWorkspace capabilities={CORE_CAPABILITIES.map(({ id, name, icon, description }) => ({ id, name, icon, description }))} />
    </>
  );
}
