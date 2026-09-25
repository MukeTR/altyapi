import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginFooter, LoginForm } from "@/components/auth/login-form";
import { getI18n } from "@/lib/i18n/server";
import { safeNextPath } from "@/lib/redirects";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("auth.login.metaTitle") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await getI18n();
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const reason = typeof params.reason === "string" ? params.reason : null;
  return (
    <AuthCard title={t("auth.login.title")} subtitle={t("auth.login.subtitle")} footer={<LoginFooter />}>
      <LoginForm next={next} reason={reason} />
    </AuthCard>
  );
}
