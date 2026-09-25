"use client";

import { useI18n } from "@/components/providers/i18n-provider";
import { CopyButton } from "@/components/ui/copy-button";
import { ScrollX } from "@/components/ui/scroll-x";
import type { DnsInstruction } from "@/lib/domains/types";

/**
 * A DNS name or value that may wrap only after a dot, never inside a label, so a merchant copying
 * it by hand reads whole labels ("stores.altyapi.<br>store", not "stores.altyapi.s<br>tore").
 * <wbr> adds no characters, so selecting and copying the text still yields the exact value.
 */
function DnsText({ value }: { value: string }) {
  const labels = value.split(".");
  return (
    <code className="min-w-0 font-mono">
      {labels.map((label, i) => (
        <span key={i}>
          <span className="whitespace-nowrap">{i < labels.length - 1 ? `${label}.` : label}</span>
          {i < labels.length - 1 ? <wbr /> : null}
        </span>
      ))}
    </code>
  );
}

/** DNS records the merchant adds at their DNS provider, each value copyable. */
export function DnsRecords({ records, hostname }: { records: readonly DnsInstruction[]; hostname: string }) {
  const { t } = useI18n();
  if (records.length === 0) return <p className="text-sm text-fg-muted">{t("domains.dns.none")}</p>;
  const purpose = (r: DnsInstruction) => t.maybe(`domains.purposes.${r.purpose}`) ?? r.purpose;
  return (
    <>
      {/* Phones: one card per record, so hostnames and targets get the full width. */}
      <ul className="flex flex-col gap-2 sm:hidden" aria-label={t("domains.dns.caption", { hostname })}>
        {records.map((r, i) => (
          <li key={`${r.type}-${r.name}-${i}`} className="rounded-md border border-border p-3 text-sm">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              <dt className="text-fg-muted">{t("domains.dns.type")}</dt>
              <dd className="font-mono font-medium">{r.type}</dd>
              <dt className="text-fg-muted">{t("domains.dns.name")}</dt>
              <dd className="flex items-start gap-1">
                <DnsText value={r.name} />
                <CopyButton value={r.name} label={t("domains.dns.copyName", { type: r.type })} />
              </dd>
              <dt className="text-fg-muted">{t("domains.dns.value")}</dt>
              <dd className="flex items-start gap-1">
                <DnsText value={r.value} />
                <CopyButton value={r.value} label={t("domains.dns.copyValue", { type: r.type })} />
              </dd>
              <dt className="text-fg-muted">{t("domains.dns.purpose")}</dt>
              <dd className="text-fg-muted">{purpose(r)}</dd>
            </dl>
          </li>
        ))}
      </ul>
      <ScrollX className="rounded-md border border-border max-sm:hidden" label={t("domains.dns.caption", { hostname })}>
        <table className="w-full text-sm">
          <caption className="sr-only">{t("domains.dns.caption", { hostname })}</caption>
          <thead className="bg-surface-muted text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t("domains.dns.type")}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t("domains.dns.name")}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t("domains.dns.value")}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t("domains.dns.purpose")}
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((r, i) => (
              <tr key={`${r.type}-${r.name}-${i}`} className="border-t border-border align-top">
                <td className="px-3 py-2 font-mono font-medium">{r.type}</td>
                <td className="px-3 py-2">
                  <span className="flex items-start gap-1">
                    <DnsText value={r.name} />
                    <CopyButton value={r.name} label={t("domains.dns.copyName", { type: r.type })} />
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-start gap-1">
                    <DnsText value={r.value} />
                    <CopyButton value={r.value} label={t("domains.dns.copyValue", { type: r.type })} />
                  </span>
                </td>
                <td className="px-3 py-2 text-fg-muted">
                  {/* Capped so this column wraps first and the records keep whole lines where they fit. */}
                  <div className="min-w-28 max-w-44">{purpose(r)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
    </>
  );
}
