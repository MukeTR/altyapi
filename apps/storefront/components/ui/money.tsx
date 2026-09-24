import { formatMoney } from "@/lib/format";

export function Price({
  amount,
  compareAt,
  currency,
  locale,
  className = "",
}: {
  amount: string | null;
  compareAt?: string | null;
  currency: string;
  locale: string;
  className?: string;
}) {
  if (amount == null) return null;
  const onSale = compareAt != null && BigInt(compareAt) > BigInt(amount);
  return (
    <span className={`inline-flex items-baseline gap-2 ${className}`}>
      <span className={onSale ? "text-sale font-semibold" : "font-semibold"}>{formatMoney(amount, currency, locale)}</span>
      {onSale && <s className="text-muted-fg text-sm">{formatMoney(compareAt, currency, locale)}</s>}
    </span>
  );
}
