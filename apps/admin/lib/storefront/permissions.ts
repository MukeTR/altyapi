import type { Permission } from "@/lib/permissions";
import type { PageType } from "./types";

/** Pages and landing pages are content; templates (home, product, cart…) belong to the storefront design. */
export function isContentPage(type: PageType | string): boolean {
  return type === "page" || type === "landing";
}

/** Permission the API requires to change a page's draft (and to undo/redo it). */
export function pageWritePermission(type: PageType | string): Permission {
  return isContentPage(type) ? "content:write" : "storefront:write";
}

/** Permission the API requires to publish, schedule or unpublish a page. */
export function pagePublishPermission(type: PageType | string): Permission {
  return isContentPage(type) ? "content:publish" : "storefront:publish";
}
