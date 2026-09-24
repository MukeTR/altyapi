import type { z } from "zod";
import type { RichBlockType } from "@altyapi/content";
import type { ModuleKey } from "@altyapi/site";

/** Page types (pages.type). "template" lays out a module or content route (pages.template_key); a section may be placed there only when its definition lists the template placement. */
export type PageTypeName = "home" | "product" | "collection" | "page" | "landing" | "cart" | "search" | "not_found" | "template";

/**
 * Placement of a section tree: a page type, the theme-level global sections, or a template
 * page ("tpl:" + template key, e.g. "tpl:entries.post.detail"). Template keys come from module
 * manifests (ModuleTemplateDef); a "{type}" segment stands for a content type key.
 */
export type TemplatePlacement = `tpl:${string}`;
export type Placement = Exclude<PageTypeName, "template"> | "global" | TemplatePlacement;

export type SectionCategory = "layout" | "hero" | "media" | "content" | "commerce" | "social_proof" | "marketing" | "template" | "business";

/**
 * Closed vocabulary of what a section does, for the site policy (K7). A compliance rule pack
 * blocks sections by tag (section.block_tag) instead of by type, so a new section is covered
 * by the rules the moment it is tagged, and a rule never needs to know section names.
 *
 *   commerce             sells or links to buying (product lists, cart, checkout triggers)
 *   price_display        shows prices
 *   social_proof         customer or client endorsement of any kind
 *   testimonial          customer statements (reviews, quotes, ratings)
 *   client_reference     names or logos of clients
 *   promotional_urgency  time pressure (countdowns, "ends soon")
 *   promo_overlay        interrupting promotional overlays (popups, slide-ins)
 *   discount             coupons, campaigns, price reductions
 *   commercial_optin     collects consent to commercial electronic messages (İYS)
 *   third_party_embed    content played or loaded from a third party (YouTube, Vimeo…)
 */
export const SECTION_POLICY_TAGS = [
  "commerce",
  "price_display",
  "social_proof",
  "testimonial",
  "client_reference",
  "promotional_urgency",
  "promo_overlay",
  "discount",
  "commercial_optin",
  "third_party_embed",
] as const;
export type SectionPolicyTag = (typeof SECTION_POLICY_TAGS)[number];

/**
 * What rich text nodes do, for the site policy. A section's tags describe the section itself;
 * a richDoc prop (rich-text@2, FAQ answers…) can also hold nodes that do something of their
 * own, so the policy checks those per node, wherever a doc sits in section or block props: a
 * policy that blocks third_party_embed refuses a YouTube embed in rich text as it refuses the
 * video section, and a product embed needs the catalog module like the product sections. A
 * refused node cannot be saved and is left out when the page renders.
 */
export const RICH_NODE_POLICY: Readonly<Partial<Record<RichBlockType, { module?: ModuleKey; tags: readonly SectionPolicyTag[] }>>> = {
  embed: { tags: ["third_party_embed"] },
  productEmbed: { module: "catalog", tags: ["commerce"] },
};

export interface SectionDefinition {
  type: string;
  version: number;
  name: { tr: string; en: string };
  category: SectionCategory;
  /**
   * Capability module the section belongs to: while the module is off for a store, the
   * section cannot be saved and is dropped when a page renders. Layout and generic content
   * sections belong to "core".
   */
  module: ModuleKey;
  /** What the section does, for the site policy (possibly none, but always declared). */
  policyTags: readonly SectionPolicyTag[];
  /**
   * Tags that apply only while a prop holds a value (not null, false, empty text or empty
   * list): a popup is a discount only when it carries a coupon code. Keys are section prop
   * keys, or "<blockType>.<prop>" for block props.
   */
  propTags: Readonly<Record<string, readonly SectionPolicyTag[]>>;
  props: z.ZodObject;
  blocks?: Record<string, z.ZodObject>;
  maxBlocks?: number;
  /** Data the renderer resolves on the server (catalog records, content entries, site identity…). */
  contentBindings: SectionBinding[];
  /**
   * Placements the section may be used in: page types, "global" (theme-level header, footer,
   * overlays) and template placements ("tpl:entries.{type}.detail" matches every content type).
   */
  allowedIn: SectionPlacementRule[];
  /** Renderer id resolved by the storefront component registry. */
  renderer: string;
  /** Only one instance per page/global tree. */
  singleton?: boolean;
  /**
   * System section: must be present exactly once on the listed placements and cannot be
   * removed or disabled by merchants or AI (checkout-critical, navigation and template main
   * sections). Enforced only while the section's module is active.
   */
  requiredIn?: SectionPlacementRule[];
  /**
   * Checks that span several props or depend on the placement (paths relative to the
   * section's props), run after the props parsed. Returns message keys with paths.
   */
  check?: (props: Record<string, unknown>, placement: Placement) => { path: string; message: string }[];
}

/** A page type, "global", or a template placement pattern ("tpl:entries.{type}.detail"). */
export type SectionPlacementRule = Exclude<PageTypeName, "template"> | "global" | TemplatePlacement;

export type SectionBinding =
  | "product"
  | "collection"
  | "products"
  | "collections"
  | "cart"
  | "search"
  | "entry"
  | "entries"
  | "business_identity"
  | "locations";

/**
 * What the site policy allows sections to do (validatePageContent, render). Faz 1 builds it
 * from the store snapshot: the active modules and no blocked tags. The compiled policy
 * snapshot (packages/compliance) fills blockedTags later, from section.block_tag rules.
 */
export interface SectionPolicy {
  /** Active capability modules of the store (StoreSnapshot.modules). */
  enabledModules: readonly string[];
  /** Tags the site policy blocks; sections carrying one are refused and not rendered. */
  blockedTags: readonly SectionPolicyTag[];
}

/** The Faz 1 policy of a store: its active modules, nothing blocked by rule packs yet. */
export function sectionPolicyFor(store: { modules: readonly string[] }): SectionPolicy {
  return { enabledModules: store.modules, blockedTags: [] };
}

const TYPE_SEGMENT = /^[a-z][a-z0-9_]{0,47}$/;

/** True when a placement rule covers a placement ("tpl:entries.{type}.detail" covers "tpl:entries.post.detail"). */
export function placementMatches(rule: SectionPlacementRule, placement: Placement): boolean {
  if (rule === placement) return true;
  if (!rule.startsWith("tpl:") || !placement.startsWith("tpl:") || !rule.includes("{type}")) return false;
  const ruleParts = rule.slice(4).split(".");
  const parts = placement.slice(4).split(".");
  return ruleParts.length === parts.length && ruleParts.every((p, i) => (p === "{type}" ? TYPE_SEGMENT.test(parts[i]!) : p === parts[i]));
}

export function templatePlacementOf(templateKey: string): TemplatePlacement {
  return `tpl:${templateKey}`;
}

/** Template keys of a content type's pages (docs/platform/site-turleri-ve-cms.md §5). */
export function entryTemplateKey(typeKey: string, kind: "detail" | "index"): string {
  return `entries.${typeKey}.${kind}`;
}

/** Placement a stored page validates and renders against. */
export function placementOfPage(page: { type: string; templateKey: string | null }): Placement {
  if (page.type === "template") {
    if (!page.templateKey) throw new Error("template page without template_key");
    return templatePlacementOf(page.templateKey);
  }
  return page.type as Placement;
}
