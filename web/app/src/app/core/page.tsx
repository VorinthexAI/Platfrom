import {
  ProductRoutePage,
  productMetadata,
} from "@/components/landing/ProductRoutePage";

export const metadata = productMetadata("core");

export default function CorePage() {
  return <ProductRoutePage productKey="core" />;
}
