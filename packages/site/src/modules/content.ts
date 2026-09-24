import { z } from "zod";
import { defineModule } from "../manifest";

/**
 * Structured content (docs/platform/site-turleri-ve-cms.md §3): content types and entries
 * (posts, services, FAQ, legal documents…) with per-record versions, slugs and references.
 *
 * Entries are guarded by content:* like pages, and pages are site core; so this module owns no
 * permission resource of its own and the entry services call assertModule(ctx, "content").
 * Entry routes come from the content types' route prefixes (dynamicRoutes); the route table
 * may refine the page class per built-in type (legal_document → legal, service → service).
 */
export const contentModule = defineModule({
  key: "content",
  version: "1.0.0",
  label: { tr: "İçerik", en: "Content" },
  description: {
    tr: "Blog yazıları, hizmet sayfaları, SSS, yasal metinler ve belgeler; çok dilli, sürümlü içerik girdileri.",
    en: "Blog posts, service pages, FAQ, legal documents and files; multilingual, versioned content entries.",
  },
  dependsOn: [],
  resources: [],
  routes: [],
  dynamicRoutes: [{ source: "content_types", cacheClass: "public", pageClass: "marketing" }],
  templates: [
    { key: "entries.{type}.detail", pageClass: "marketing" },
    { key: "entries.{type}.index", pageClass: "marketing" },
  ],
  settings: z.object({}),
  events: [
    "content.entry.published",
    "content.entry.unpublished",
    "content.entry.scheduled",
    "content.entry.archived",
    "content.entry.schedule_failed",
    "content.type.changed",
  ],
  adminNav: [{ key: "content", label: { tr: "İçerik", en: "Content" }, path: "/content", permission: "content:read", order: 20 }],
});
