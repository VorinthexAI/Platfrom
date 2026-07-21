import {
  ProductRoutePage,
  productMetadata,
} from "@/components/landing/ProductRoutePage";

export const metadata = productMetadata("replica");

export default function ReplicaPage() {
  return <ProductRoutePage productKey="replica" />;
}
