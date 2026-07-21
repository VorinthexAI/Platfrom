import { ProductRoutePage, productMetadata } from "@/components/landing/ProductRoutePage";

export const metadata = productMetadata("hq");

export default function HqPage() {
  return <ProductRoutePage productKey="hq" />;
}
