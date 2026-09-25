"use client";

import { useActionState, useEffect } from "react";
import { createOrganizationAction, type CreateOrganizationState } from "@/app/actions/tenancy";
import { FormAlert } from "@/components/auth/form-alert";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { OrganizationSummary } from "@/lib/api/types";

const INITIAL: CreateOrganizationState = { error: null, organization: null, values: {} };
const FIELD_FOR_KEY = { "errors.organization.slug_taken": "slug", "errors.organization.invalid_slug": "slug" };

export interface CreateOrganizationFormProps {
  /** Called after creation (onboarding continues with the store step). */
  onCreated?: (organization: OrganizationSummary) => void;
  /** Navigate to the new organization instead (switcher dialog). */
  redirectToOrganization?: boolean;
  onCancel?: () => void;
}

export function CreateOrganizationForm({ onCreated, redirectToOrganization, onCancel }: CreateOrganizationFormProps) {
  const { t, describeError } = useI18n();
  const [state, action, pending] = useActionState(createOrganizationAction, INITIAL);
  const error = state.error ? describeError(state.error, FIELD_FOR_KEY) : null;

  useEffect(() => {
    if (state.organization) onCreated?.(state.organization);
  }, [state.organization, onCreated]);

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      {redirectToOrganization ? <input type="hidden" name="redirectTo" value="org" /> : null}
      {error ? (
        <FormAlert tone="danger" focusKey={state}>
          {error.message}
        </FormAlert>
      ) : null}
      <Field label={t("onboarding.organization.name")} error={error?.fields.name ?? null} required>
        <Input name="name" maxLength={120} autoComplete="organization" placeholder={t("onboarding.organization.namePlaceholder")} defaultValue={state.values.name ?? ""} />
      </Field>
      <Field label={t("onboarding.organization.slug")} optional description={t("onboarding.organization.slugHint")} error={error?.fields.slug ?? null}>
        <Input name="slug" maxLength={63} autoCapitalize="none" spellCheck={false} className="font-mono" defaultValue={state.values.slug ?? ""} />
      </Field>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {onCancel ? (
          <Button onClick={onCancel} disabled={pending}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={pending}>
          {t("onboarding.organization.submit")}
        </Button>
      </div>
    </form>
  );
}
