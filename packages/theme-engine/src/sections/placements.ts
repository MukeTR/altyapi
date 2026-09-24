import type { PageTypeName, SectionPlacementRule } from "./types";

/** Every page type except templates. */
export const ALL_PAGES: Exclude<PageTypeName, "template">[] = ["home", "product", "collection", "page", "landing", "cart", "search", "not_found"];

/** Page types that carry free content sections around (or instead of) their main section. */
export const CONTENT_PAGES: Exclude<PageTypeName, "template">[] = ["home", "page", "landing", "collection", "product", "not_found"];

/** Template pages of content types: the entry detail and the index / taxonomy archive layouts. */
export const ENTRY_DETAIL_TEMPLATE: SectionPlacementRule = "tpl:entries.{type}.detail";
export const ENTRY_INDEX_TEMPLATE: SectionPlacementRule = "tpl:entries.{type}.index";
export const ENTRY_TEMPLATES: SectionPlacementRule[] = [ENTRY_DETAIL_TEMPLATE, ENTRY_INDEX_TEMPLATE];
