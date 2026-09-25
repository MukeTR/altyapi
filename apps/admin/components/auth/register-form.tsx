"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerAction, type AuthFormState } from "@/app/actions/auth";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormAlert } from "./form-alert";
import { useAuthErrorMessage } from "./login-form";

const INITIAL: AuthFormState = { error: null, values: {} };
const FIELD_FOR_KEY = { "errors.user.email_taken": "email", "errors.password.too_short": "password" };

export function RegisterForm() {
  const { t, locale } = useI18n();
  const describe = useAuthErrorMessage();
  const [state, action, pending] = useActionState(registerAction, INITIAL);
  const error = state.error ? describe(state.error, FIELD_FOR_KEY) : null;
  const emailTaken = state.error?.messageKey === "errors.user.email_taken";

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      {error ? (
        <FormAlert tone="danger" focusKey={state}>
          {error.message}
          {emailTaken ? (
            <>
              {" "}
              <Link href="/login">{t("auth.register.emailTakenAction")}</Link>
            </>
          ) : null}
        </FormAlert>
      ) : null}
      <Field label={t("auth.register.name")} error={error?.fields.name ?? null} required>
        <Input name="name" size="lg" autoComplete="name" maxLength={120} defaultValue={state.values.name ?? ""} />
      </Field>
      <Field label={t("auth.register.email")} error={error?.fields.email ?? null} required>
        <Input name="email" type="email" size="lg" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} defaultValue={state.values.email ?? ""} />
      </Field>
      <Field label={t("auth.register.password")} description={t("auth.register.passwordHint")} error={error?.fields.password ?? null} required>
        <Input name="password" type="password" size="lg" autoComplete="new-password" minLength={10} maxLength={256} />
      </Field>
      <Field label={t("auth.register.locale")}>
        <Select
          name="locale"
          size="lg"
          defaultValue={state.values.locale ?? locale}
          options={[
            { value: "tr", label: "Türkçe" },
            { value: "en", label: "English" },
          ]}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-2 w-full">
        {t("auth.register.submit")}
      </Button>
    </form>
  );
}

export function RegisterFooter() {
  const { t } = useI18n();
  return (
    <>
      {t("auth.register.haveAccount")} <Link href="/login">{t("auth.register.signIn")}</Link>
    </>
  );
}
