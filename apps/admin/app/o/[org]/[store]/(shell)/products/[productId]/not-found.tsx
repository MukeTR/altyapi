import { RecordNotFound } from "@/components/commerce/record-not-found";

export default function ProductNotFound() {
  return <RecordNotFound backPath="/products" backLabel="products.backToList" />;
}
