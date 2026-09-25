import { RecordNotFound } from "@/components/commerce/record-not-found";

export default function ContentTypeNotFound() {
  return <RecordNotFound backPath="/content" backLabel="content.backToTypes" />;
}
