import { z } from "zod";
import type { SiteVerificationMeta, SiteVerificationProvider } from "@altyapi/database";
import { blankToNull } from "./fields";
import { PAGE_URL_STYLES, SITE_KINDS, UNTRANSLATED_POLICIES } from "./types";

export const VERIFICATION_PROVIDERS = ["google", "bing", "yandex", "pinterest", "facebook"] as const satisfies readonly SiteVerificationProvider[];

/** <meta name> each provider checks for its ownership token. */
export const VERIFICATION_META_NAMES: Readonly<Record<SiteVerificationProvider, string>> = {
  google: "google-site-verification",
  bing: "msvalidate.01",
  yandex: "yandex-verification",
  pinterest: "p:domain_verify",
  facebook: "facebook-domain-verification",
};

/** Accepts the bare token or the whole <meta> tag a provider shows, and keeps the token. */
export function extractVerificationToken(value: string): string {
  const tag = /content\s*=\s*["']([^"']*)["']/i.exec(value);
  return (tag ? tag[1]! : value).trim();
}

const verificationToken = z
  .string()
  .transform(extractVerificationToken)
  .pipe(z.string().regex(/^[A-Za-z0-9_\-.=]{4,128}$/, { error: "errors.site.profile.invalid_verification_token" }));

/**
 * Site profile changes (K6). Pack pinning (primaryPack, addonPacks) is not editable here: packs
 * are installed and upgraded through vertical pack releases, never typed in.
 */
export const siteProfileUpdateSchema = z.strictObject({
  /** Informational after onboarding: modules are changed through the module services. */
  kind: z.enum(SITE_KINDS).optional(),
  /** prefixed: pages under /pages/{handle}; root: pages at /{handle} (and /pages/* redirects there). */
  pageUrlStyle: z.enum(PAGE_URL_STYLES).optional(),
  /** hide: 404 for untranslated records; fallback_noindex: default-language content marked noindex. */
  untranslatedPolicy: z.enum(UNTRANSLATED_POLICIES).optional(),
  /** Training crawlers in robots.txt; search and answer bots are always allowed. */
  aiCrawlers: z.strictObject({ training: z.enum(["allow", "deny"]) }).optional(),
  /** Replaces all verification tokens; a provider left out or blank is removed. */
  verificationMeta: z
    .partialRecord(z.enum(VERIFICATION_PROVIDERS), z.preprocess(blankToNull, verificationToken.nullable()))
    .transform((meta): SiteVerificationMeta => Object.fromEntries(Object.entries(meta).filter(([, token]) => token)) as SiteVerificationMeta)
    .optional(),
});

export type SiteProfileUpdateInput = z.input<typeof siteProfileUpdateSchema>;
