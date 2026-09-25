"use server";

import { redirect } from "next/navigation";
import { ApiError, type ApiErrorInfo } from "@/lib/api/errors";
import { redirectToLogin } from "@/lib/api/load";
import { api } from "@/lib/api/server";
import type { OrganizationSummary, Store } from "@/lib/api/types";
import { serverEnv, storefrontOrigin } from "@/lib/env";

export interface CreateOrganizationState {
  error: ApiErrorInfo | null;
  organization: OrganizationSummary | null;
  values: { name?: string; slug?: string };
}

export interface CreateStoreState {
  error: ApiErrorInfo | null;
  values: Record<string, string>;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function failure(err: unknown): Promise<ApiErrorInfo> {
  if (!(err instanceof ApiError)) throw err;
  if (err.status === 401) await redirectToLogin();
  return err.toInfo();
}

/** Creates an organization; the creator becomes its owner. With redirectTo=org the user lands on it. */
export async function createOrganizationAction(_prev: CreateOrganizationState, formData: FormData): Promise<CreateOrganizationState> {
  const name = text(formData, "name");
  const slug = text(formData, "slug");
  let organization: OrganizationSummary;
  try {
    organization = await api<OrganizationSummary>("/v1/organizations", { method: "POST", body: { name, ...(slug ? { slug } : {}) } });
  } catch (err) {
    return { error: await failure(err), organization: null, values: { name, slug } };
  }
  if (text(formData, "redirectTo") === "org") redirect(`/o/${organization.slug}`);
  return { error: null, organization, values: { name, slug } };
}

/**
 * Creates a store (the API also bootstraps its storefront, default location, base price list
 * and tax class) and opens it.
 */
export async function createStoreAction(_prev: CreateStoreState, formData: FormData): Promise<CreateStoreState> {
  const organizationId = text(formData, "organizationId");
  const organizationSlug = text(formData, "organizationSlug");
  const values = {
    name: text(formData, "name"),
    slug: text(formData, "slug").toLowerCase(),
    defaultLocale: text(formData, "defaultLocale"),
    defaultCurrency: text(formData, "defaultCurrency").toUpperCase(),
    timezone: text(formData, "timezone"),
    countryCode: text(formData, "countryCode").toUpperCase(),
    contactEmail: text(formData, "contactEmail"),
  };
  const body: Record<string, string> = { name: values.name };
  for (const key of ["slug", "defaultLocale", "defaultCurrency", "timezone", "countryCode", "contactEmail"] as const) {
    if (values[key]) body[key] = values[key];
  }
  let store: Store;
  try {
    store = await api<Store>(`/v1/organizations/${encodeURIComponent(organizationId)}/stores`, { method: "POST", body });
  } catch (err) {
    return { error: await failure(err), values };
  }
  redirect(`/o/${encodeURIComponent(organizationSlug)}/${store.slug}`);
}

export type PreviewLinkResult = { ok: true; url: string; expiresInSeconds: number } | { ok: false; error: ApiErrorInfo };

/**
 * Mints a one-hour, store-bound preview token and returns the storefront URL that turns on
 * draft preview. Anyone with the link sees unpublished changes until it expires.
 */
export async function createPreviewLinkAction(organizationId: string, storeId: string, storeSlug: string, path = "/"): Promise<PreviewLinkResult> {
  try {
    const { token, expiresInSeconds } = await api<{ token: string; expiresInSeconds: number }>(
      `/v1/organizations/${encodeURIComponent(organizationId)}/stores/${encodeURIComponent(storeId)}/storefront/preview-token`,
      { method: "POST" },
    );
    const origin = storefrontOrigin(`${storeSlug}.${serverEnv.storeRootDomain()}`);
    const target = new URL(path.startsWith("/") ? path : "/", origin);
    target.searchParams.set("preview_token", token);
    return { ok: true, url: target.toString(), expiresInSeconds };
  } catch (err) {
    return { ok: false, error: await failure(err) };
  }
}
