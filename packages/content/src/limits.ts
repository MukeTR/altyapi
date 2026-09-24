/**
 * Hard limits of the content model (docs/platform/site-turleri-ve-cms.md §3.2). They bound
 * storage, publish-time derivation and editor payloads; plan entitlements may lower the
 * custom type count later, never raise the others.
 */
export const CONTENT_LIMITS = {
  /** Active custom (non built-in) content types per site. */
  customTypesPerStore: 30,
  /** Fields per content type, built-in and custom together (group and repeater children count once each). */
  fieldsPerType: 60,
  /** Items of a repeater; repeaters and groups nest one level only (their children are plain fields). */
  repeaterItems: 100,
  /** Serialized draft data of one entry (UTF-8 bytes). */
  entryBytes: 256 * 1024,
  /** Text characters of one richDoc per locale. */
  richDocCharsPerLocale: 200_000,
  /** Options of a select or multi-select field. */
  selectOptions: 100,
  /** Targets of a multi-reference field. */
  multiReferenceItems: 100,
  /** Assets of a gallery field. */
  galleryItems: 100,
  /** Entries per page of the storefront list API. */
  livePageSize: 48,
  /** Entries per page of the admin list API. */
  adminPageSize: 100,
} as const;
