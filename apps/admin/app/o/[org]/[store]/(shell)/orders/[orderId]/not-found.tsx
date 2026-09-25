import { RecordNotFound } from "@/components/commerce/record-not-found";

export default function OrderNotFound() {
  return <RecordNotFound backPath="/orders" backLabel="orders.backToList" />;
}
