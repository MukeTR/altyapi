import { ListPageSkeleton } from "@/components/commerce/list-page-skeleton";

export default function Loading() {
  return <ListPageSkeleton tabs rows={10} actions />;
}
