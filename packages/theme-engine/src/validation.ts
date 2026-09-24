import { z } from "zod";
import { isLocaleCode, newId } from "@altyapi/commerce-core";
import type { PageContent, SectionInstance } from "@altyapi/database";
import { SITE_MODULES } from "@altyapi/site";
import { getSectionDefinition, latestSectionDefinitions } from "./sections/definitions";
import { placementMatches, RICH_NODE_POLICY, type Placement, type SectionDefinition, type SectionPolicy, type SectionPolicyTag } from "./sections/types";

export const MAX_SECTIONS_PER_PAGE = 60;

/**
 * Design content may never carry executable code. Pixels, analytics and other scripts belong
 * to the protected tracking layer; rich text is sanitized and this guard rejects anything that
 * still looks like code in any prop (e.g. pasted embed snippets in plain text fields),
 * including image tags: a noscript tracking pixel is an <img>.
 */
const CODE_PATTERN = /<\s*\/?\s*(script|iframe|object|embed|link|meta|style|base|form|img)\b|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|<[^>]*\son[a-z]+\s*=/i;

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

/** True when a prop holds something a prop tag applies to (not empty, false or null). */
function hasValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

/** Prop tags of a definition that the policy blocks, split into section props and block props. */
function blockedPropTags(def: SectionDefinition, blocked: ReadonlySet<SectionPolicyTag>): { props: Map<string, SectionPolicyTag>; blocks: Map<string, Map<string, SectionPolicyTag>> } {
  const props = new Map<string, SectionPolicyTag>();
  const blocks = new Map<string, Map<string, SectionPolicyTag>>();
  for (const [path, tags] of Object.entries(def.propTags)) {
    const tag = tags.find((t) => blocked.has(t));
    if (!tag) continue;
    const [first, second] = path.split(".");
    if (second === undefined) props.set(first!, tag);
    else blocks.set(first!, new Map([...(blocks.get(first!) ?? []), [second, tag]]));
  }
  return { props, blocks };
}

/** Why the site policy refuses a section as a whole: its module is off or one of its tags is blocked. */
function sectionRefusal(def: SectionDefinition, policy: SectionPolicy): string | null {
  if (!policy.enabledModules.includes(def.module)) return `errors.section.module_disabled:${def.module}`;
  const tag = def.policyTags.find((t) => policy.blockedTags.includes(t));
  return tag ? `errors.section.blocked_by_policy:${tag}` : null;
}

/** Why the site policy refuses a rich text node: its module is off or one of its tags is blocked (RICH_NODE_POLICY). */
function richNodeRefusal(nodeType: unknown, policy: SectionPolicy): string | null {
  const rule = typeof nodeType === "string" ? RICH_NODE_POLICY[nodeType as keyof typeof RICH_NODE_POLICY] : undefined;
  if (!rule) return null;
  if (rule.module && !policy.enabledModules.includes(rule.module)) return `errors.section.module_disabled:${rule.module}`;
  const tag = rule.tags.find((t) => policy.blockedTags.includes(t));
  return tag ? `errors.section.node_blocked_by_policy:${tag}` : null;
}

type RichNodeLike = { type?: unknown; content?: unknown };

function isRichDoc(value: unknown): value is { type: "doc"; content: unknown[] } {
  return !!value && typeof value === "object" && (value as RichNodeLike).type === "doc" && Array.isArray((value as RichNodeLike).content);
}

/** Refused nodes of every rich text doc anywhere in a props value, with their content paths. */
function refusedRichNodes(value: unknown, path: string, policy: SectionPolicy, out: ContentIssue[]): void {
  const nodes = (list: unknown[], at: string) =>
    list.forEach((node, i) => {
      if (!node || typeof node !== "object") return;
      const refusal = richNodeRefusal((node as RichNodeLike).type, policy);
      if (refusal) out.push({ path: `${at}.${i}`, message: refusal });
      const children = (node as RichNodeLike).content;
      if (Array.isArray(children)) nodes(children, `${at}.${i}.content`);
    });
  if (isRichDoc(value)) nodes(value.content, `${path}.content`);
  else if (Array.isArray(value)) value.forEach((v, i) => refusedRichNodes(v, `${path}.${i}`, policy, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) refusedRichNodes(v, `${path}.${k}`, policy, out);
}

/** A props value with the refused nodes of its rich text docs left out (render time). */
function stripRefusedNodes<T>(value: T, policy: SectionPolicy): T {
  const nodes = (list: unknown[]): unknown[] =>
    list.flatMap((node) => {
      if (!node || typeof node !== "object") return [node];
      if (richNodeRefusal((node as RichNodeLike).type, policy)) return [];
      const children = (node as RichNodeLike).content;
      return [Array.isArray(children) ? { ...node, content: nodes(children) } : node];
    });
  if (isRichDoc(value)) return { ...value, content: nodes(value.content) } as T;
  if (Array.isArray(value)) return value.map((v) => stripRefusedNodes(v, policy)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripRefusedNodes(v, policy)])) as T;
  }
  return value;
}

/** Module that owns a template placement ("tpl:entries.post.detail" → content), or null when no manifest declares it. */
export function templateModule(placement: Placement): string | null {
  if (!placement.startsWith("tpl:")) return null;
  return SITE_MODULES.templateFor(placement.slice(4))?.module ?? null;
}

/**
 * Validates a section tree against the registry and the site policy, and returns it
 * normalized: ids assigned, versions pinned, defaults applied and rich text sanitized.
 * Reported with paths: unknown sections, sections not allowed in the placement, sections of
 * modules that are off or carrying tags the policy blocks (also per prop: a coupon code on a
 * popup when discounts are blocked; and per rich text node: a YouTube embed in rich text when
 * third-party embeds are blocked, see RICH_NODE_POLICY), duplicate singletons, invalid props
 * and missing required sections. Template placements must be declared by an active module.
 */
export function validatePageContent(
  input: PageContentInput,
  placement: Placement,
  policy: SectionPolicy,
): { ok: true; content: PageContent } | { ok: false; issues: ContentIssue[] } {
  const issues: ContentIssue[] = [];
  const seenIds = new Set<string>();
  const singletons = new Set<string>();
  const sections: SectionInstance[] = [];
  const blocked = new Set(policy.blockedTags);

  if (placement.startsWith("tpl:")) {
    const module = templateModule(placement);
    if (!module) issues.push({ path: "sections", message: "errors.section.unknown_template" });
    else if (!policy.enabledModules.includes(module)) issues.push({ path: "sections", message: `errors.section.module_disabled:${module}` });
  }

  input.sections.forEach((raw, i) => {
    const path = `sections.${i}`;
    const def = getSectionDefinition(raw.type, raw.version);
    if (!def) {
      issues.push({ path: `${path}.type`, message: "errors.section.unknown_type" });
      return;
    }
    if (!def.allowedIn.some((rule) => placementMatches(rule, placement))) {
      issues.push({ path: `${path}.type`, message: "errors.section.not_allowed_here" });
      return;
    }
    const refusal = sectionRefusal(def, policy);
    if (refusal) {
      issues.push({ path: `${path}.type`, message: refusal });
      return;
    }
    if (def.singleton) {
      if (singletons.has(def.type)) issues.push({ path, message: "errors.section.singleton_duplicate" });
      singletons.add(def.type);
    }
    const id = raw.id && !seenIds.has(raw.id) ? raw.id : newId();
    seenIds.add(id);
    const propRules = blockedPropTags(def, blocked);

    const props = def.props.safeParse(raw.props);
    if (!props.success) {
      for (const issue of props.error.issues) issues.push({ path: `${path}.props.${issue.path.join(".")}`, message: issue.message });
    } else {
      for (const issue of def.check?.(props.data as Record<string, unknown>, placement) ?? []) issues.push({ path: `${path}.props.${issue.path}`, message: issue.message });
      for (const [key, tag] of propRules.props) {
        if (hasValue((props.data as Record<string, unknown>)[key])) issues.push({ path: `${path}.props.${key}`, message: `errors.section.prop_blocked_by_policy:${tag}` });
      }
      refusedRichNodes(props.data, `${path}.props`, policy, issues);
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
          for (const [key, tag] of propRules.blocks.get(b.type) ?? []) {
            if (hasValue((parsed.data as Record<string, unknown>)[key])) issues.push({ path: `${path}.blocks.${j}.props.${key}`, message: `errors.section.prop_blocked_by_policy:${tag}` });
          }
          refusedRichNodes(parsed.data, `${path}.blocks.${j}.props`, policy, issues);
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
    if (def.requiredIn?.some((rule) => placementMatches(rule, placement)) && raw.disabled) {
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

  // System sections required on this placement must be present (they cannot be deleted), as
  // long as the policy lets them exist at all.
  for (const def of latestSectionDefinitions()) {
    if (!def.requiredIn?.some((rule) => placementMatches(rule, placement)) || sectionRefusal(def, policy)) continue;
    if (!input.sections.some((sec) => sec.type === def.type)) issues.push({ path: "sections", message: `errors.section.required_missing:${def.type}` });
  }

  return issues.length ? { ok: false, issues } : { ok: true, content: { sections } };
}

/**
 * The render-time side of the policy: sections of modules that are off or carrying a blocked
 * tag are left out, props carrying a blocked prop tag fall back to their defaults (a popup
 * without its coupon code) and rich text nodes the policy refuses are left out of their docs.
 * Stored content is never modified; turning the module back on brings everything back.
 */
export function applySectionPolicy(sections: readonly SectionInstance[], policy: SectionPolicy): SectionInstance[] {
  const blocked = new Set(policy.blockedTags);
  const hasRefusedNodes = (props: Record<string, unknown>) => {
    const found: ContentIssue[] = [];
    refusedRichNodes(props, "props", policy, found);
    return found.length > 0;
  };
  return sections.flatMap((s) => {
    const def = getSectionDefinition(s.type, s.version);
    if (!def) return [s];
    if (sectionRefusal(def, policy)) return [];
    const rules = blockedPropTags(def, blocked);
    const nodesRefused = hasRefusedNodes(s.props) || (s.blocks ?? []).some((b) => hasRefusedNodes(b.props));
    if (!rules.props.size && !rules.blocks.size && !nodesRefused) return [s];
    const reset = (schema: SectionDefinition["props"], values: Record<string, unknown>, keys: Iterable<string>) => {
      const out = { ...values };
      for (const key of keys) {
        const field = schema.shape[key] as { safeParse(v: unknown): { success: boolean; data?: unknown } } | undefined;
        const fallback = field?.safeParse(undefined);
        out[key] = fallback?.success ? fallback.data : null;
      }
      return out;
    };
    const clean = (props: Record<string, unknown>) => (nodesRefused ? stripRefusedNodes(props, policy) : props);
    return [
      {
        ...s,
        props: clean(reset(def.props, s.props, rules.props.keys())),
        ...(s.blocks
          ? {
              blocks: s.blocks.map((b) => {
                const keys = rules.blocks.get(b.type);
                const schema = def.blocks?.[b.type];
                return { ...b, props: clean(keys && schema ? reset(schema, b.props, keys.keys()) : b.props) };
              }),
            }
          : {}),
      },
    ];
  });
}

/**
 * Localized text maps (`{ tr: "…", en: "…" }`: every key a registry locale code, every value
 * text) anywhere in the section and block props of a tree, with their content paths.
 */
export function localizedTextMaps(content: PageContent): { path: string; map: Record<string, string> }[] {
  const out: { path: string; map: Record<string, string> }[] = [];
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) value.forEach((v, i) => visit(v, `${path}.${i}`));
    else if (value && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length && entries.every(([k, v]) => isLocaleCode(k) && (typeof v === "string" || v === undefined))) {
        out.push({ path, map: value as Record<string, string> });
      } else for (const [k, v] of entries) visit(v, `${path}.${k}`);
    }
  };
  content.sections.forEach((s, i) => {
    visit(s.props, `sections.${i}.props`);
    (s.blocks ?? []).forEach((b, j) => visit(b.props, `sections.${i}.blocks.${j}.props`));
  });
  return out;
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
