import type { PublicBusinessIdentity, PublicLocation, RenderSection } from "@altyapi/theme-engine";
import { mediaUrl } from "@/lib/media";
import { formatDate } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { L, type RenderCtx } from "../context";
import type { HeadingTag } from "./render";
import { SectionShell } from "./shell";
import { assetKey } from "./content";

/**
 * Business identity sections (imprint, facts, opening hours, locations). Data comes from the
 * site's business profile through the route resolver; a section with nothing to show renders
 * nothing. Maps are links to the map provider: no map script or frame is ever loaded.
 */

type Address = NonNullable<PublicLocation["address"]>;
type Hours = PublicLocation["openingHours"];
type Props = Record<string, unknown>;

/**
 * Phone numbers, e-mail addresses and registry codes read left to right in every page
 * language; isolated so a right-to-left page does not reorder their digits and signs.
 */
export function Ltr({ children }: { children: React.ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

/** Postal address; inline renders it on one line (compact fact lists). */
export function AddressBlock({ address, inline = false }: { address: Address; inline?: boolean }) {
  const cityLine = [address.postalCode, [address.ilce, address.il].filter(Boolean).join(" / ")].filter(Boolean).join(" ");
  return (
    // Each line is isolated: an address written left to right keeps its punctuation in place on right-to-left pages.
    <address className={inline ? "inline not-italic" : "not-italic"}>
      <bdi>
        {address.street}
        {address.mahalle ? <>, {address.mahalle}</> : null}
      </bdi>
      {inline ? ", " : <br />}
      <bdi>
        {cityLine}
        {address.country && address.country !== "TR" ? <>, {address.country}</> : null}
      </bdi>
    </address>
  );
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Weekday names in the page language (2024-01-01 was a Monday). */
function weekdayName(locale: string, index: number): string {
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + index)));
}

function intervalText(ctx: RenderCtx, opens: string, closes: string): string {
  return opens === "00:00" && closes === "00:00" ? t(ctx.locale, "openAllDay") : `${opens}–${closes}`;
}

/**
 * Today in the store's time zone: the date (YYYY-MM-DD) and the weekday (0 = Monday). Pages
 * stay in shared caches for about a minute, so the highlighted day follows midnight closely.
 */
function todayIn(timeZone: string): { date: string; weekday: number } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return { date, weekday: (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7 };
}

type SpecialDay = Hours["specialDays"][number];

function specialDayText(ctx: RenderCtx, d: SpecialDay): string {
  return d.closed || !d.hours.length ? t(ctx.locale, "closed") : d.hours.map((h) => intervalText(ctx, h.opens, h.closes)).join(", ");
}

/**
 * The weekly hours, today's row highlighted (a special day covering today replaces its regular
 * hours), then the upcoming special days and the note.
 */
export function OpeningHoursTable({ ctx, hours, showSpecialDays = true, showNote = true }: { ctx: RenderCtx; hours: Hours; showSpecialDays?: boolean; showNote?: boolean }) {
  const hasWeekly = hours.weekly.length > 0;
  const today = todayIn(ctx.site.timezone);
  const todaySpecial = hours.specialDays.find((d) => d.from <= today.date && today.date <= d.to);
  const special = showSpecialDays ? hours.specialDays.filter((d) => d.to >= today.date) : [];
  const note = showNote ? L(ctx, hours.note) : "";
  if (!hasWeekly && !hours.byAppointment && !special.length && !note) return null;
  return (
    <div className="flex flex-col gap-3">
      {hours.byAppointment && <p className="font-medium">{t(ctx.locale, "byAppointment")}</p>}
      {hasWeekly && (
        <table className="w-full max-w-md text-sm">
          <tbody>
            {WEEKDAYS.map((day, i) => {
              const rows = hours.weekly.filter((r) => r.days.includes(day));
              const isToday = i === today.weekday;
              const override = isToday ? todaySpecial : undefined;
              const label = override ? L(ctx, override.label) : "";
              return (
                <tr key={day} aria-current={isToday ? "date" : undefined} className={`border-b border-line last:border-0 ${isToday ? "bg-muted font-semibold" : ""}`}>
                  <th scope="row" className={`py-1.5 pe-4 text-start ${isToday ? "ps-2" : "font-medium"}`}>
                    {weekdayName(ctx.locale, i)}
                    {isToday && <span className="ms-2 text-xs font-normal text-muted-fg">{t(ctx.locale, "today")}</span>}
                  </th>
                  <td className={`py-1.5 text-end tabular-nums ${isToday ? "pe-2" : ""}`}>
                    {override
                      ? `${specialDayText(ctx, override)}${label ? ` (${label})` : ""}`
                      : rows.length
                        ? rows.map((r) => intervalText(ctx, r.opens, r.closes)).join(", ")
                        : t(ctx.locale, "closed")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {special.length > 0 && (
        <div className="text-sm">
          <p className="mb-1 font-medium">{t(ctx.locale, "specialDays")}</p>
          <ul className="flex flex-col gap-1">
            {special.map((d, i) => (
              <li key={i}>
                <time dateTime={d.from}>{formatDate(d.from, ctx.locale, "UTC")}</time>
                {d.to !== d.from && (
                  <>
                    {" – "}
                    <time dateTime={d.to}>{formatDate(d.to, ctx.locale, "UTC")}</time>
                  </>
                )}
                {L(ctx, d.label) ? ` (${L(ctx, d.label)})` : ""}: {specialDayText(ctx, d)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {note && <p className="text-sm text-muted-fg">{note}</p>}
    </div>
  );
}

function ContactLinks({ ctx, phone, email, whatsapp }: { ctx: RenderCtx; phone: string | null; email: string | null; whatsapp?: string | null }) {
  if (!phone && !email && !whatsapp) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {phone && (
        <li>
          <span className="sr-only">{t(ctx.locale, "phone")}: </span>
          <a href={`tel:${phone}`}>
            <Ltr>{phone}</Ltr>
          </a>
        </li>
      )}
      {whatsapp && (
        <li>
          <a href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`} rel="noopener noreferrer" target="_blank">
            {t(ctx.locale, "whatsapp")}
          </a>
        </li>
      )}
      {email && (
        <li>
          <span className="sr-only">{t(ctx.locale, "emailLabel")}: </span>
          <a href={`mailto:${email}`}>
            <Ltr>{email}</Ltr>
          </a>
        </li>
      )}
    </ul>
  );
}

type Row = { key: string; label: string; value: React.ReactNode };

function FactList({ rows, layout }: { rows: Row[]; layout: "list" | "grid" | "compact" }) {
  if (layout === "compact") {
    return (
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-fg">
        {rows.map((r) => (
          <div key={r.key} className="flex gap-1">
            <dt className="font-medium">{r.label}:</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className={layout === "grid" ? "grid gap-6 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(10rem,auto)_1fr]"}>
      {rows.map((r) =>
        layout === "grid" ? (
          <div key={r.key} className="flex flex-col gap-1">
            <dt className="text-sm text-muted-fg">{r.label}</dt>
            <dd className="font-medium">{r.value}</dd>
          </div>
        ) : (
          <div key={r.key} className="contents">
            <dt className="text-muted-fg">{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ),
      )}
    </dl>
  );
}

const identityOf = (s: RenderSection, ctx: RenderCtx) => (s.data?.identity as PublicBusinessIdentity | null | undefined) ?? ctx.site.businessIdentity;

/** Imprint rows (6563 m.3): name and legal form, address, contact and KEP, registry numbers, tax office, professional body. */
function imprintRows(ctx: RenderCtx, id: PublicBusinessIdentity, compact = false): Row[] {
  const rows: Row[] = [];
  const add = (key: MessageKey, value: React.ReactNode) => rows.push({ key, label: t(ctx.locale, key), value });
  if (id.legalName) add("legalName", id.legalName);
  if (id.tradeName && id.tradeName !== id.legalName) add("tradeName", id.tradeName);
  if (id.legalForm) add("legalForm", t(ctx.locale, `legal_${id.legalForm}` as MessageKey));
  if (id.address) add("address", <AddressBlock address={id.address} inline={compact} />);
  if (id.phone) add("phone", <a href={`tel:${id.phone}`}><Ltr>{id.phone}</Ltr></a>);
  if (id.email) add("emailLabel", <a href={`mailto:${id.email}`}><Ltr>{id.email}</Ltr></a>);
  if (id.kepAddress) add("kepAddress", <Ltr>{id.kepAddress}</Ltr>);
  if (id.mersisNo) add("mersisNo", <Ltr>{id.mersisNo}</Ltr>);
  if (id.tradeRegistryNo) add("tradeRegistryNo", <Ltr>{id.tradeRegistryNo}</Ltr>);
  if (id.taxOffice) add("taxOffice", id.taxOffice);
  if (id.taxNumber) add("taxNumber", <Ltr>{id.taxNumber}</Ltr>);
  if (id.chamber) {
    add(
      "chamber",
      id.chamberRulesUrl ? (
        <>
          {id.chamber} ·{" "}
          <a href={id.chamberRulesUrl} rel="noopener noreferrer" target="_blank" className="underline underline-offset-4">
            {t(ctx.locale, "chamberRules")}
          </a>
        </>
      ) : (
        id.chamber
      ),
    );
  }
  return rows;
}

export const statutoryInfoHeading = (s: RenderSection, ctx: RenderCtx) => {
  const id = identityOf(s, ctx);
  return id && imprintRows(ctx, id).length ? L(ctx, s.props.heading) || t(ctx.locale, "imprint") : "";
};

export function StatutoryInfo({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Props;
  const id = identityOf(s, ctx);
  if (!id) return null;
  const compact = p.layout === "compact";
  const rows = imprintRows(ctx, id, compact);
  if (!rows.length) return null;
  const logo = p.showLogo && id.logoAssetId ? assetKey(ctx, id.logoAssetId) : null;
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className="flex flex-col gap-4">
        <H className={compact ? "text-lg" : "text-2xl"}>{L(ctx, p.heading) || t(ctx.locale, "imprint")}</H>
        {logo && <img src={mediaUrl(ctx.mediaBase, logo) ?? undefined} alt={id.tradeName ?? id.legalName ?? ctx.site.name} className="h-12 w-auto self-start" loading="lazy" />}
        <FactList rows={rows} layout={compact ? "compact" : "list"} />
      </div>
    </SectionShell>
  );
}

function factRows(ctx: RenderCtx, s: RenderSection): Row[] {
  const id = identityOf(s, ctx);
  const count = Number(s.data?.locationCount ?? 0);
  const rows: Row[] = [];
  const add = (key: string, label: MessageKey, value: React.ReactNode) => rows.push({ key, label: t(ctx.locale, label), value });
  for (const fact of (s.props.facts as string[]) ?? []) {
    switch (fact) {
      case "tradeName":
        if (id?.tradeName) add(fact, "tradeName", id.tradeName);
        break;
      case "legalName":
        if (id?.legalName) add(fact, "legalName", id.legalName);
        break;
      case "legalForm":
        if (id?.legalForm) add(fact, "legalForm", t(ctx.locale, `legal_${id.legalForm}` as MessageKey));
        break;
      case "foundingDate":
        if (id?.foundingDate) add(fact, "foundingDate", <time dateTime={id.foundingDate}>{formatDate(id.foundingDate, ctx.locale, "UTC")}</time>);
        break;
      case "address":
        if (id?.address) add(fact, "address", <AddressBlock address={id.address} />);
        break;
      case "phone":
        if (id?.phone) add(fact, "phone", <a href={`tel:${id.phone}`}><Ltr>{id.phone}</Ltr></a>);
        break;
      case "email":
        if (id?.email) add(fact, "emailLabel", <a href={`mailto:${id.email}`}><Ltr>{id.email}</Ltr></a>);
        break;
      case "kepAddress":
        if (id?.kepAddress) add(fact, "kepAddress", <Ltr>{id.kepAddress}</Ltr>);
        break;
      case "chamber":
        if (id?.chamber) add(fact, "chamber", id.chamber);
        break;
      case "mersisNo":
        if (id?.mersisNo) add(fact, "mersisNo", <Ltr>{id.mersisNo}</Ltr>);
        break;
      case "tradeRegistryNo":
        if (id?.tradeRegistryNo) add(fact, "tradeRegistryNo", <Ltr>{id.tradeRegistryNo}</Ltr>);
        break;
      case "taxOffice":
        if (id?.taxOffice) {
          add(
            fact,
            "taxOffice",
            <>
              {id.taxOffice}
              {id.taxNumber ? (
                <>
                  {" · "}
                  <Ltr>{id.taxNumber}</Ltr>
                </>
              ) : null}
            </>,
          );
        }
        break;
      case "naceCodes":
        if (id?.identifiers.nace?.length) add(fact, "naceCodes", <Ltr>{id.identifiers.nace.join(", ")}</Ltr>);
        break;
      case "locationCount":
        if (count > 0) add(fact, "locationCount", count);
        break;
      case "sameAs":
        if (id?.sameAs.length) {
          add(
            fact,
            "sameAs",
            <ul className="flex flex-col gap-1">
              {id.sameAs.map((url) => (
                <li key={url}>
                  <a href={url} rel="noopener noreferrer me" target="_blank" className="underline underline-offset-4">
                    {url.replace(/^https:\/\/(www\.)?/, "")}
                  </a>
                </li>
              ))}
            </ul>,
          );
        }
        break;
    }
  }
  return rows;
}

export const businessFactsHeading = (s: RenderSection, ctx: RenderCtx) => (factRows(ctx, s).length ? L(ctx, s.props.heading) : "");

export function BusinessFacts({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Props;
  const rows = factRows(ctx, s);
  if (!rows.length) return null;
  const heading = L(ctx, p.heading);
  return (
    <SectionShell s={s} ctx={ctx}>
      {heading && <H className="mb-6 text-2xl">{heading}</H>}
      <FactList rows={rows} layout={p.layout === "list" ? "list" : "grid"} />
    </SectionShell>
  );
}

const hoursLocation = (s: RenderSection) => (s.data?.location as PublicLocation | null | undefined) ?? null;

/** The section shows something: exactly what OpeningHoursTable renders for its props. */
function hoursVisible(s: RenderSection, ctx: RenderCtx): boolean {
  const l = hoursLocation(s);
  if (!l) return false;
  const h = l.openingHours;
  const today = todayIn(ctx.site.timezone).date;
  return (
    h.weekly.length > 0 ||
    h.byAppointment ||
    (Boolean(s.props.showSpecialDays) && h.specialDays.some((d) => d.to >= today)) ||
    (Boolean(s.props.showNote) && Boolean(L(ctx, h.note)))
  );
}

export const openingHoursHeading = (s: RenderSection, ctx: RenderCtx) => (hoursVisible(s, ctx) ? L(ctx, s.props.heading) || t(ctx.locale, "openingHours") : "");

export function OpeningHoursSection({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Props;
  const location = hoursLocation(s);
  if (!location || !hoursVisible(s, ctx)) return null;
  return (
    <SectionShell s={s} ctx={ctx}>
      <div className="flex flex-col gap-4">
        <H className="text-2xl">{L(ctx, p.heading) || t(ctx.locale, "openingHours")}</H>
        <OpeningHoursTable ctx={ctx} hours={location.openingHours} showSpecialDays={Boolean(p.showSpecialDays)} showNote={Boolean(p.showNote)} />
      </div>
    </SectionShell>
  );
}

type MapLocation = PublicLocation & { mapUrl: string | null };
const mapLocations = (s: RenderSection) => (s.data?.locations as MapLocation[] | undefined) ?? [];

export const locationsMapHeading = (s: RenderSection, ctx: RenderCtx) => (mapLocations(s).length ? L(ctx, s.props.heading) || t(ctx.locale, "locations") : "");

export function LocationsMap({ s, ctx, heading: H }: { s: RenderSection; ctx: RenderCtx; heading: HeadingTag }) {
  const p = s.props as Props;
  const locations = mapLocations(s);
  if (!locations.length) return null;
  return (
    <SectionShell s={s} ctx={ctx}>
      <H className="mb-6 text-2xl">{L(ctx, p.heading) || t(ctx.locale, "locations")}</H>
      <ul className={p.layout === "list" ? "flex flex-col divide-y divide-line" : "grid gap-6 md:grid-cols-2 lg:grid-cols-3"}>
        {locations.map((l) => (
          <li key={l.id} className={p.layout === "list" ? "py-5" : "rounded-theme border border-line p-5"}>
            <article className="flex flex-col gap-3">
              <h3 className="text-lg font-semibold">{l.name}</h3>
              {l.address && <AddressBlock address={l.address} />}
              {Boolean(p.showContact) && <ContactLinks ctx={ctx} phone={l.phone} email={l.email} whatsapp={l.whatsapp} />}
              {Boolean(p.showOpeningHours) && <OpeningHoursTable ctx={ctx} hours={l.openingHours} />}
              {l.mapUrl && (
                <a href={l.mapUrl} rel="noopener noreferrer" target="_blank" className="self-start text-sm underline underline-offset-4">
                  {t(ctx.locale, "showOnMap")}
                </a>
              )}
            </article>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}
