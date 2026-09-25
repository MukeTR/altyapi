import { ListPageSkeleton } from "@/components/commerce/list-page-skeleton";

export default function Loading() {
  return <ListPageSkeleton rows={6} columns={6} actions />;
}
