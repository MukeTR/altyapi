import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { RegisterFooter, RegisterForm } from "@/components/auth/register-form";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("auth.register.metaTitle") };
}

export default async function RegisterPage() {
  const { t } = await getI18n();
  return (
    <AuthCard title={t("auth.register.title")} subtitle={t("auth.register.subtitle")} footer={<RegisterFooter />}>
      <RegisterForm />
    </AuthCard>
  );
}
