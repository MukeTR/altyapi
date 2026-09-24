import { documentType, faqItemType, legalDocumentType, postCategoryType, postType, serviceCategoryType, serviceType, tagType } from "./builtin";
import { assertValidDefinition, type ContentTypeDefinition } from "./definition";

/** Built-in content types, mirroring SECTION_DEFINITIONS: code is the source of truth, sites install them. */
export const CONTENT_TYPE_DEFINITIONS: readonly ContentTypeDefinition[] = [
  postType,
  postCategoryType,
  tagType,
  serviceType,
  serviceCategoryType,
  faqItemType,
  legalDocumentType,
  documentType,
];

for (const def of CONTENT_TYPE_DEFINITIONS) assertValidDefinition(def, CONTENT_TYPE_DEFINITIONS);

const byKey = new Map(CONTENT_TYPE_DEFINITIONS.map((d) => [d.key, d]));

export function getContentTypeDefinition(key: string): ContentTypeDefinition | undefined {
  return byKey.get(key);
}

/**
 * Entry data written against an older definition version, brought up to the current one
 * through the definition's upgrade hook.
 */
export function upgradeEntryData(def: ContentTypeDefinition, data: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  if (fromVersion >= def.version || !def.upgrade) return data;
  return def.upgrade(data, fromVersion);
}
