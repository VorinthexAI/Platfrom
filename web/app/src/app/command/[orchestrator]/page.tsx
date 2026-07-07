import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingPage } from "@/components/landing/LandingPage";
import { OrchestratorDetail } from "@/components/landing/DeepLinkDetail";
import {
  getEntityBySlug,
  getOrchestratorsForCommand,
} from "@/lib/galaxy/registry-helpers";
import { buildMetadataFromEntity } from "@/lib/galaxy/seo";
import {
  breadcrumbJsonLdForEntity,
  entityJsonLd,
} from "@/lib/structured-data";

interface OrchestratorPageProps {
  params: Promise<{ orchestrator: string }>;
}

export function generateStaticParams() {
  return getOrchestratorsForCommand().map((orchestrator) => ({
    orchestrator: orchestrator.slug,
  }));
}

export async function generateMetadata({
  params,
}: OrchestratorPageProps): Promise<Metadata> {
  const { orchestrator: slug } = await params;
  const entity = getEntityBySlug(`command.${slug}`);
  if (!entity) return {};
  return buildMetadataFromEntity(entity);
}

export default async function OrchestratorPage({
  params,
}: OrchestratorPageProps) {
  const { orchestrator: slug } = await params;
  const entity = getEntityBySlug(`command.${slug}`);
  if (!entity || entity.type !== "orchestrator") notFound();

  const jsonLd = [entityJsonLd(entity), breadcrumbJsonLdForEntity(entity)];

  return (
    <>
      {jsonLd.map((entry, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(entry) }}
        />
      ))}
      <LandingPage
        initialEntityId={entity.id}
        detail={<OrchestratorDetail entity={entity} />}
      />
    </>
  );
}
