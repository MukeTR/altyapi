"use client";

import { ArrowLeft, Copy, Eye, EyeOff, Globe, Lock, MousePointerClick, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Tabs } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { instanceIssues } from "@/lib/storefront/issues";
import { definitionOf, isRequiredOn } from "@/lib/storefront/sections";
import type { BlockInstance, Placement, SectionInstance } from "@/lib/storefront/types";
import { useEditorContext } from "./editor-context";
import { SchemaFields, useIssueMessage } from "./schema-fields";
import { AppearanceForm, VisibilityForm } from "./section-forms";
import { useBlockName, useSectionName, type Scope } from "./section-tree";

type Change<T> = (next: T, opts?: { immediate?: boolean }) => void;

function PanelHeader({ title, badges, actions, back }: { title: string; badges?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
      {back}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-md font-semibold text-fg">{title}</h2>
          {badges ? <div className="flex flex-wrap gap-1.5">{badges}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 gap-0.5">{actions}</div> : null}
      </div>
    </div>
  );
}

function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <span className="inline-flex">
        <Button size="icon-sm" variant="ghost" aria-label={label} onClick={onClick} disabled={disabled}>
          {children}
        </Button>
      </span>
    </Tooltip>
  );
}

/** Nothing selected yet. */
export function EmptyPanel() {
  const { t } = useI18n();
  return <EmptyState icon={MousePointerClick} title={t("editor.props.noSelectionTitle")} description={t("editor.props.noSelectionBody")} />;
}

/** Properties of a section: content (generated from its schema), appearance and visibility. */
export function SectionPanel({
  section,
  scope,
  placement,
  onChange,
  onToggleHidden,
  onDuplicate,
  onRemove,
}: {
  section: SectionInstance;
  scope: Scope;
  placement: Placement;
  onChange: Change<SectionInstance>;
  onToggleHidden: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const { definitions, canEdit, issues } = useEditorContext();
  const nameOf = useSectionName();
  const issueText = useIssueMessage();
  const def = definitionOf(definitions, section.type, section.version);
  const required = isRequiredOn(def, placement);
  const base = `section:${section.id}`;
  const own = instanceIssues(issues, base);
  const name = nameOf(def, section.type);

  return (
    <div className="flex min-h-0 flex-col">
      <PanelHeader
        title={name}
        badges={
          <>
            {scope === "global" ? (
              <Badge tone="info">
                <Globe aria-hidden="true" className="size-3" />
                {t("editor.props.onAllPages")}
              </Badge>
            ) : null}
            {required ? (
              <Badge>
                <Lock aria-hidden="true" className="size-3" />
                {t("editor.tree.required")}
              </Badge>
            ) : null}
            {section.disabled ? <Badge tone="warning">{t("editor.tree.hidden")}</Badge> : null}
          </>
        }
        actions={
          canEdit ? (
            <>
              <IconAction label={section.disabled ? t("editor.tree.show") : t("editor.tree.hide")} onClick={onToggleHidden} disabled={required}>
                {section.disabled ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
              </IconAction>
              <IconAction label={t("editor.tree.duplicate")} onClick={onDuplicate} disabled={required || Boolean(def?.singleton)}>
                <Copy aria-hidden="true" />
              </IconAction>
              <IconAction label={t("editor.tree.delete")} onClick={onRemove} disabled={required}>
                <Trash2 aria-hidden="true" />
              </IconAction>
            </>
          ) : null
        }
      />
      <div className="flex flex-col gap-4 px-4 py-4">
        {required ? <p className="text-sm text-fg-muted">{t("editor.tree.requiredHint")}</p> : null}
        {scope === "global" ? <p className="text-sm text-fg-muted">{t("editor.props.globalHint")}</p> : null}
        {own.map((i) => (
          <InlineAlert key={i.path + i.message} tone="danger">
            {issueText(i.message)}
          </InlineAlert>
        ))}
        {!def ? (
          <InlineAlert tone="warning">{t("editor.props.unknownDefinition", { type: section.type })}</InlineAlert>
        ) : (
          <Tabs
            aria-label={t("editor.props.tabs")}
            items={[
              {
                value: "content",
                label: t("editor.props.content"),
                content: (
                  <SchemaFields
                    schema={def.props}
                    root={def.props}
                    value={section.props}
                    onChange={(props, o) => onChange({ ...section, props }, o)}
                    issueBase={base}
                    fieldPrefix="props"
                    container={section.type}
                  />
                ),
              },
              { value: "appearance", label: t("editor.props.appearance"), content: <AppearanceForm section={section} issueBase={base} onChange={onChange} /> },
              { value: "visibility", label: t("editor.props.visibility"), content: <VisibilityForm section={section} scope={scope} issueBase={base} onChange={onChange} /> },
            ]}
          />
        )}
      </div>
    </div>
  );
}

/** Properties of one block (a slide, an FAQ item, a message). */
export function BlockPanel({
  section,
  block,
  onChange,
  onBack,
  onDuplicate,
  onRemove,
}: {
  section: SectionInstance;
  block: BlockInstance;
  onChange: Change<BlockInstance>;
  onBack: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const { definitions, canEdit } = useEditorContext();
  const nameOf = useSectionName();
  const blockName = useBlockName();
  const def = definitionOf(definitions, section.type, section.version);
  const schema = def?.blocks[block.type];
  const sectionName = nameOf(def, section.type);
  return (
    <div className="flex min-h-0 flex-col">
      <PanelHeader
        back={
          <Button variant="link" size="sm" className="self-start text-sm" onClick={onBack}>
            <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
            {sectionName}
          </Button>
        }
        title={blockName(block.type)}
        actions={
          canEdit ? (
            <>
              <IconAction label={t("editor.tree.duplicate")} onClick={onDuplicate} disabled={Boolean(def && def.maxBlocks !== null && (section.blocks?.length ?? 0) >= def.maxBlocks)}>
                <Copy aria-hidden="true" />
              </IconAction>
              <IconAction label={t("editor.tree.delete")} onClick={onRemove}>
                <Trash2 aria-hidden="true" />
              </IconAction>
            </>
          ) : null
        }
      />
      <div className="px-4 py-4">
        {schema ? (
          <SchemaFields schema={schema} root={schema} value={block.props} onChange={(props, o) => onChange({ ...block, props }, o)} issueBase={`section:${section.id}/block:${block.id}`} fieldPrefix="props" container={block.type} />
        ) : (
          <InlineAlert tone="warning">{t("editor.props.unknownBlock", { type: block.type })}</InlineAlert>
        )}
      </div>
    </div>
  );
}
