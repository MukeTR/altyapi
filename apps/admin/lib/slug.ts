/**
 * Mirrors slugify() in @altyapi/commerce-core (which cannot be bundled for the browser because
 * it lives next to node:crypto code). Used only for the live "{slug}.altyapi.store" preview;
 * the API computes and validates the real slug.
 */
const TR_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };

export function slugify(input: string, maxLength = 63): string {
  return input
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => TR_MAP[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}
