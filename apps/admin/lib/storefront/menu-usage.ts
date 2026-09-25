import type { SectionInstance } from "@/lib/storefront/types";

/** Where the theme's global sections use each menu: header menuHandle, footer menuHandles. */
export function menuUsage(sections: readonly SectionInstance[], labels: { header: string; footer: string }): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (handle: unknown, label: string) => {
    if (typeof handle !== "string") return;
    const list = (out[handle] ??= []);
    if (!list.includes(label)) list.push(label);
  };
  for (const s of sections) {
    if (s.type === "header") add(s.props.menuHandle, labels.header);
    if (s.type === "footer" && Array.isArray(s.props.menuHandles)) for (const h of s.props.menuHandles) add(h, labels.footer);
  }
  return out;
}
