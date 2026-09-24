import type { CSSProperties, ReactNode } from "react";
import type { RenderSection } from "@altyapi/theme-engine";
import { VisibilityGate } from "../client/visibility-gate";
import type { RenderCtx } from "../context";

/** Common wrapper: color scheme, spacing, responsive hiding, anchor and client targeting. */
export function SectionShell({ s, ctx, children, as = "section", fullWidthDefault = false }: { s: RenderSection; ctx: RenderCtx; children: ReactNode; as?: "section" | "div" | "header" | "footer"; fullWidthDefault?: boolean }) {
  const st = s.settings ?? {};
  const hide = (st.hideOn ?? []).map((d) => `hide-${d}`).join(" ");
  const pt = st.paddingTop ?? {};
  const pb = st.paddingBottom ?? {};
  const style = {
    "--pt-m": `${pt.mobile ?? pt.desktop ?? 32}px`,
    "--pt-d": `${pt.desktop ?? pt.mobile ?? 48}px`,
    "--pb-m": `${pb.mobile ?? pb.desktop ?? 32}px`,
    "--pb-d": `${pb.desktop ?? pb.mobile ?? 48}px`,
  } as CSSProperties;
  const scheme = st.colorScheme ?? (typeof s.props.colorScheme === "string" ? s.props.colorScheme : undefined);
  const Tag = as;
  const fullWidth = st.fullWidth ?? fullWidthDefault;
  const inner = (
    <Tag
      id={st.anchorId}
      data-section-type={s.type}
      data-section-id={s.id}
      {...(scheme ? { "data-scheme": scheme } : {})}
      className={`${hide} pt-[var(--pt-m)] pb-[var(--pb-m)] lg:pt-[var(--pt-d)] lg:pb-[var(--pb-d)]`}
      style={style}
    >
      <div className={fullWidth ? "" : "container-theme"}>{children}</div>
    </Tag>
  );
  return s.visibility ? (
    <VisibilityGate rules={s.visibility} locale={ctx.locale}>
      {inner}
    </VisibilityGate>
  ) : (
    inner
  );
}
