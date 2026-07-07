import {
  ProductRoutePage,
  productMetadata,
} from "@/components/landing/ProductRoutePage";

export const metadata = productMetadata("command");

export default function CommandPage() {
  return <ProductRoutePage productKey="command" />;
}
