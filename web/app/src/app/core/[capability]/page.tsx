import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingPage } from "@/components/landing/LandingPage";
import { CapabilityDetail } from "@/components/landing/DeepLinkDetail";
import { coreCapabilities, getCapability } from "@/data/capabilities";
import { buildMetadataFromEntity } from "@/lib/galaxy/seo";
import {
  breadcrumbJsonLdForEntity,
  entityJsonLd,
} from "@/lib/structured-data";

interface CapabilityPageProps {
  params: Promise<{ capability: string }>;
}

export function generateStaticParams() {
  return coreCapabilities.map((capability) => ({
    capability: capability.slug,
  }));
}

export async function generateMetadata({
  params,
}: CapabilityPageProps): Promise<Metadata> {
  const { capability: slug } = await params;
  const capability = getCapability(slug);
  if (!capability) return {};
  return buildMetadataFromEntity(capability.entity);
}

export default async function CapabilityPage({ params }: CapabilityPageProps) {
  const { capability: slug } = await params;
  const capability = getCapability(slug);
  if (!capability) notFound();

  const jsonLd = [
    entityJsonLd(capability.entity),
    breadcrumbJsonLdForEntity(capability.entity),
  ];

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
        initialEntityId={capability.entity.id}
        detail={<CapabilityDetail capability={capability} />}
      />
    </>
  );
}
