import { missingRequired } from "./schema";
import { definitionOf } from "./sections";
import type { SectionDefinition, SectionInstance } from "./types";

export interface Issue {
  path: string;
  message: string;
}

/** Message of a required value the editor found missing before saving. */
export const REQUIRED = "required";

/**
 * Rewrites the API's index-based issue paths ("sections.2.blocks.0.props.question.tr") into
 * id-based ones ("section:<id>/block:<id>/props.question.tr") using the sections that were sent,
 * so issues stay attached to the right section when the user reorders afterwards.
 */
export function mapSectionIssues(issues: readonly Issue[], sections: readonly SectionInstance[]): Issue[] {
  return issues.map((issue) => {
    const m = /^sections\.(\d+)(?:\.blocks\.(\d+))?(?:\.(.+))?$/.exec(issue.path);
    if (!m) return issue;
    const section = sections[Number(m[1])];
    if (!section) return issue;
    const block = m[2] !== undefined ? section.blocks?.[Number(m[2])] : undefined;
    const rest = m[3] ?? "";
    return { ...issue, path: `section:${section.id}${block ? `/block:${block.id}` : ""}${rest ? `/${rest}` : ""}` };
  });
}

/** Required props (and block props) that are still empty, as id-based issues. */
export function requiredIssues(sections: readonly SectionInstance[], defs: readonly SectionDefinition[]): Issue[] {
  const out: Issue[] = [];
  for (const s of sections) {
    const def = definitionOf(defs, s.type, s.version);
    if (!def) continue;
    for (const key of missingRequired(def.props, s.props, def.props)) out.push({ path: `section:${s.id}/props.${key}`, message: REQUIRED });
    for (const b of s.blocks ?? []) {
      const schema = def.blocks[b.type];
      if (!schema) continue;
      for (const key of missingRequired(schema, b.props, schema)) out.push({ path: `section:${s.id}/block:${b.id}/props.${key}`, message: REQUIRED });
    }
  }
  return out;
}

export function sectionHasIssue(issues: readonly Issue[], sectionId: string): boolean {
  return issues.some((i) => i.path === `section:${sectionId}` || i.path.startsWith(`section:${sectionId}/`));
}

export function blockHasIssue(issues: readonly Issue[], sectionId: string, blockId: string): boolean {
  const base = `section:${sectionId}/block:${blockId}`;
  return issues.some((i) => i.path === base || i.path.startsWith(`${base}/`));
}

/**
 * The first issue for a field of a section or block form. `field` is the path inside the
 * instance ("props.heading", "settings.anchorId"); nested and per-language paths match too.
 */
export function fieldIssue(issues: readonly Issue[], base: string, field: string): Issue | undefined {
  const full = `${base}/${field}`;
  return issues.find((i) => i.path === full || i.path.startsWith(`${full}.`));
}

/** Issues about the instance as a whole (not a single field), e.g. a duplicate singleton. */
export function instanceIssues(issues: readonly Issue[], base: string): Issue[] {
  return issues.filter((i) => i.path === base || (i.path.startsWith(`${base}/`) && !/\/(props|settings|visibility|block:)/.test(i.path.slice(base.length))));
}
