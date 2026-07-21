import type { Metadata } from "next";
import type { ProductKey } from "@/data/products";
import { productByKey } from "@/data/products";
import { buildMetadataFromEntity } from "@/lib/galaxy/seo";
import {
  breadcrumbJsonLdForEntity,
  entityJsonLd,
} from "@/lib/structured-data";
import { LandingPage } from "./LandingPage";
import { ProductDetail } from "./DeepLinkDetail";

/** Shared implementation for product routes. */
export function productMetadata(key: ProductKey): Metadata {
  return buildMetadataFromEntity(productByKey.get(key)!.entity);
}

export function ProductRoutePage({ productKey }: { productKey: ProductKey }) {
  const product = productByKey.get(productKey)!;
  const jsonLd = [
    entityJsonLd(product.entity),
    breadcrumbJsonLdForEntity(product.entity),
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
        initialEntityId={product.entity.id}
        detail={<ProductDetail product={product} />}
      />
    </>
  );
}
