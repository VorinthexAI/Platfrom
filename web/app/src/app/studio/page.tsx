import {
  ProductRoutePage,
  productMetadata,
} from "@/components/landing/ProductRoutePage";

export const metadata = productMetadata("studio");

export default function StudioPage() {
  return <ProductRoutePage productKey="studio" />;
}
