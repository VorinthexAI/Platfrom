import {
  ProductRoutePage,
  productMetadata,
} from "@/components/landing/ProductRoutePage";

export const metadata = productMetadata("pilot");

export default function PilotPage() {
  return <ProductRoutePage productKey="pilot" />;
}
