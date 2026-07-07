import {
  ProductRoutePage,
  productMetadata,
} from "@/components/landing/ProductRoutePage";

export const metadata = productMetadata("launch");

export default function LaunchPage() {
  return <ProductRoutePage productKey="launch" />;
}
