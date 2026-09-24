import {
  businessLegalForm,
  pageUrlStyle,
  siteKind,
  siteLocationStatus,
  siteModuleSource,
  siteModuleStatus,
  untranslatedPolicy,
} from "@altyapi/database";

export type SiteKind = (typeof siteKind.enumValues)[number];
export type SiteModuleStatus = (typeof siteModuleStatus.enumValues)[number];
export type SiteModuleSource = (typeof siteModuleSource.enumValues)[number];
export type PageUrlStyle = (typeof pageUrlStyle.enumValues)[number];
export type UntranslatedPolicy = (typeof untranslatedPolicy.enumValues)[number];
export type BusinessLegalForm = (typeof businessLegalForm.enumValues)[number];
export type SiteLocationStatus = (typeof siteLocationStatus.enumValues)[number];

export const SITE_KINDS = siteKind.enumValues;
export const PAGE_URL_STYLES = pageUrlStyle.enumValues;
export const UNTRANSLATED_POLICIES = untranslatedPolicy.enumValues;
export const BUSINESS_LEGAL_FORMS = businessLegalForm.enumValues;
export const SITE_LOCATION_STATUSES = siteLocationStatus.enumValues;
