import { ListPageSkeleton } from "@/components/commerce/list-page-skeleton";

export default function Loading() {
  return <ListPageSkeleton rows={10} columns={5} />;
}
