"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "./button";
import { useFieldControl } from "./field";
import { Input } from "./input";

/** undefined = keep the stored value, null = remove it, string = replace it. */
export type SecretValue = string | null | undefined;

export interface SecretInputProps {
  /** Whether the API reports a stored value (secrets are never read back). */
  saved: boolean;
  value: SecretValue;
  onChange: (value: SecretValue) => void;
  /** Allow removing a stored value. */
  removable?: boolean;
  id?: string;
  placeholder?: string;
}

/** Write-only credential field: shows "Saved ●●●●" with Change / Remove instead of the value. */
export function SecretInput({ saved, value, onChange, removable = true, id, placeholder }: SecretInputProps) {
  const { t } = useI18n();
  const field = useFieldControl(id);
  const [visible, setVisible] = useState(false);
  const editing = typeof value === "string" || !saved;

  if (value === null) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-base">
        <span className="text-danger">{t("ui.secret.willRemove")}</span>
        <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
          {t("ui.secret.keep")}
        </Button>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span id={field?.id ?? id} className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface-muted px-2.5 text-base text-fg-muted">
          {t("ui.secret.saved")} <span aria-hidden="true">●●●●</span>
        </span>
        <Button size="sm" onClick={() => onChange("")}>
          {t("ui.secret.change")}
        </Button>
        {removable ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            {t("ui.secret.remove")}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <Input
          {...(id ? { id } : {})}
          type={visible ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono"
        />
      </div>
      <Button size="icon-md" variant="ghost" aria-label={visible ? t("ui.secret.hide") : t("ui.secret.show")} aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
      {saved ? (
        <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
          {t("ui.secret.keep")}
        </Button>
      ) : null}
    </div>
  );
}
