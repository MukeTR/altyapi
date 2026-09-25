"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, type AuthFormState } from "@/app/actions/auth";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { FormAlert } from "./form-alert";

const INITIAL: AuthFormState = { error: null, values: {} };

export function useAuthErrorMessage() {
  const { t, describeError } = useI18n();
  return (error: ApiErrorInfo, fieldForKey?: Record<string, string>) => {
    const d = describeError(error, fieldForKey);
    if (error.code === "rate_limited") {
      return { ...d, message: error.retryAfter ? t("auth.errors.rateLimited", { seconds: error.retryAfter }) : t("auth.errors.rateLimitedShort") };
    }
    return d;
  };
}

export function LoginForm({ next, reason }: { next: string; reason: string | null }) {
  const { t } = useI18n();
  const describe = useAuthErrorMessage();
  const [state, action, pending] = useActionState(loginAction, INITIAL);
  const error = state.error ? describe(state.error) : null;

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      {error ? (
        <FormAlert tone="danger" focusKey={state}>
          {error.message}
        </FormAlert>
      ) : reason === "expired" ? (
        <FormAlert tone="info" focusKey={null}>
          {t("auth.login.expired")}
        </FormAlert>
      ) : reason === "signed_out" ? (
        <FormAlert tone="success" focusKey={null}>
          {t("auth.login.loggedOut")}
        </FormAlert>
      ) : null}
      <Field label={t("auth.login.email")} error={error?.fields.email ?? null} required>
        <Input name="email" type="email" size="lg" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} defaultValue={state.values.email ?? ""} />
      </Field>
      <Field label={t("auth.login.password")} error={error?.fields.password ?? null} required>
        <Input name="password" type="password" size="lg" autoComplete="current-password" />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-2 w-full">
        {t("auth.login.submit")}
      </Button>
    </form>
  );
}

export function LoginFooter() {
  const { t } = useI18n();
  return (
    <>
      {t("auth.login.noAccount")} <Link href="/register">{t("auth.login.createAccount")}</Link>
    </>
  );
}
