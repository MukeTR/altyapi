import { z } from "zod";
import { newId } from "@altyapi/commerce-core";
import type { PageContent, SectionInstance } from "@altyapi/database";
import { getSectionDefinition, SECTION_DEFINITIONS, type PageTypeName } from "./sections/definitions";

export const MAX_SECTIONS_PER_PAGE = 60;

/**
 * Design content may never carry executable code. Pixels, analytics and other scripts belong
 * to the protected tracking layer; rich text is sanitized and this guard rejects anything that
 * still looks like code in any prop (e.g. pasted embed snippets in plain text fields).
 */
const CODE_PATTERN = /<\s*\/?\s*(script|iframe|object|embed|link|meta|style|base|form)\b|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|<[^>]*\son[a-z]+\s*=/i;

/** True when a text would be rejected by the code guard (for callers that build content from external text). */
export function containsCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}

function findCode(value: unknown, path: string, out: ContentIssue[]) {
  if (typeof value === "string") {
    if (CODE_PATTERN.test(value)) out.push({ path, message: "errors.section.code_not_allowed" });
  } else if (Array.isArray(value)) value.forEach((v, i) => findCode(v, `${path}.${i}`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) findCode(v, `${path}.${k}`, out);
}

export interface ContentIssue {
  path: string;
  message: string;
}

const visibilitySchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }).nullable().optional(),
    endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
    devices: z.array(z.enum(["mobile", "tablet", "desktop"])).optional(),
    routes: z.array(z.string().max(300)).max(50).optional(),
    excludeRoutes: z.array(z.string().max(300)).max(50).optional(),
    segmentIds: z.array(z.uuid()).max(20).optional(),
    locales: z.array(z.string().max(10)).optional(),
    utm: z
      .object({
        source: z.array(z.string().max(100)).optional(),
        medium: z.array(z.string().max(100)).optional(),
        campaign: z.array(z.string().max(100)).optional(),
      })
      .optional(),
    referrerContains: z.array(z.string().max(200)).max(20).optional(),
  })
  .optional();

const settingsSchema = z
  .object({
    paddingTop: z.record(z.string(), z.number().int().min(0).max(200)).optional(),
    paddingBottom: z.record(z.string(), z.number().int().min(0).max(200)).optional(),
    hideOn: z.array(z.enum(["mobile", "tablet", "desktop"])).optional(),
    colorScheme: z.string().max(40).optional(),
    fullWidth: z.boolean().optional(),
    anchorId: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
  })
  .optional();

const instanceInputSchema = z.object({
  id: z.string().max(64).optional(),
  type: z.string().max(64),
  version: z.number().int().positive().optional(),
  props: z.record(z.string(), z.unknown()).default({}),
  settings: settingsSchema,
  visibility: visibilitySchema,
  blocks: z
    .array(z.object({ id: z.string().max(64).optional(), type: z.string().max(64), props: z.record(z.string(), z.unknown()).default({}) }))
    .optional(),
  disabled: z.boolean().optional(),
});

export const pageContentInputSchema = z.object({ sections: z.array(instanceInputSchema).max(MAX_SECTIONS_PER_PAGE) });
export type PageContentInput = z.infer<typeof pageContentInputSchema>;

/**
 * Validates a section tree against the registry and returns it normalized: ids assigned,
 * versions pinned, defaults applied and rich text sanitized. Unknown sections, sections not
 * allowed on the page type, duplicate singletons and invalid props are reported with paths.
 */
export function validatePageContent(
  input: PageContentInput,
  placement: PageTypeName | "global",
): { ok: true; content: PageContent } | { ok: false; issues: ContentIssue[] } {
  const issues: ContentIssue[] = [];
  const seenIds = new Set<string>();
  const singletons = new Set<string>();
  const sections: SectionInstance[] = [];

  input.sections.forEach((raw, i) => {
    const path = `sections.${i}`;
    const def = getSectionDefinition(raw.type, raw.version);
    if (!def) {
      issues.push({ path: `${path}.type`, message: "errors.section.unknown_type" });
      return;
    }
    if (!def.allowedIn.includes(placement)) {
      issues.push({ path: `${path}.type`, message: "errors.section.not_allowed_here" });
      return;
    }
    if (def.singleton) {
      if (singletons.has(def.type)) issues.push({ path, message: "errors.section.singleton_duplicate" });
      singletons.add(def.type);
    }
    const id = raw.id && !seenIds.has(raw.id) ? raw.id : newId();
    seenIds.add(id);

    const props = def.props.safeParse(raw.props);
    if (!props.success) {
      for (const issue of props.error.issues) issues.push({ path: `${path}.props.${issue.path.join(".")}`, message: issue.message });
    }

    const blocks: NonNullable<SectionInstance["blocks"]> = [];
    if (raw.blocks?.length) {
      if (!def.blocks) issues.push({ path: `${path}.blocks`, message: "errors.section.blocks_not_supported" });
      else if (def.maxBlocks !== undefined && raw.blocks.length > def.maxBlocks) {
        issues.push({ path: `${path}.blocks`, message: "errors.section.too_many_blocks" });
      } else {
        raw.blocks.forEach((b, j) => {
          const schema = def.blocks![b.type];
          if (!schema) {
            issues.push({ path: `${path}.blocks.${j}.type`, message: "errors.section.unknown_block_type" });
            return;
          }
          const parsed = schema.safeParse(b.props);
          if (!parsed.success) {
            for (const issue of parsed.error.issues) {
              issues.push({ path: `${path}.blocks.${j}.props.${issue.path.join(".")}`, message: issue.message });
            }
            return;
          }
          const blockId = b.id && !seenIds.has(b.id) ? b.id : newId();
          seenIds.add(blockId);
          blocks.push({ id: blockId, type: b.type, props: parsed.data as Record<string, unknown> });
        });
      }
    }

    if (raw.visibility?.startsAt && raw.visibility.endsAt && raw.visibility.startsAt >= raw.visibility.endsAt) {
      issues.push({ path: `${path}.visibility`, message: "errors.section.invalid_schedule" });
    }

    if (props.success) findCode(props.data, `${path}.props`, issues);
    blocks.forEach((b, j) => findCode(b.props, `${path}.blocks.${j}.props`, issues));
    if (def.requiredIn?.includes(placement) && raw.disabled) {
      issues.push({ path, message: "errors.section.required_cannot_be_disabled" });
    }

    if (props.success) {
      sections.push({
        id,
        type: def.type,
        version: def.version,
        props: props.data as Record<string, unknown>,
        ...(raw.settings ? { settings: raw.settings } : {}),
        ...(raw.visibility ? { visibility: raw.visibility as SectionInstance["visibility"] } : {}),
        ...(blocks.length ? { blocks } : {}),
        ...(raw.disabled ? { disabled: true } : {}),
      });
    }
  });

  // System sections required on this placement must be present (they cannot be deleted).
  for (const def of SECTION_DEFINITIONS) {
    if (def.requiredIn?.includes(placement) && !input.sections.some((sec) => sec.type === def.type)) {
      issues.push({ path: "sections", message: `errors.section.required_missing:${def.type}` });
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true, content: { sections } };
}

/** Asset ids referenced anywhere in a tree (for asset reference tracking). */
export function collectAssetIds(content: PageContent): string[] {
  const out = new Set<string>();
  const visit = (value: unknown, key?: string) => {
    if (typeof value === "string" && key && /AssetId$|^assetId$/.test(key)) out.add(value);
    else if (Array.isArray(value)) value.forEach((v) => visit(v));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) visit(v, k);
  };
  for (const s of content.sections) {
    visit(s.props);
    for (const b of s.blocks ?? []) visit(b.props);
  }
  return [...out];
}
