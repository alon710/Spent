import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChatClient } from "@/components/chat/chat-client";
import { ChatDisabled } from "@/components/chat/chat-disabled";
import { AppShell } from "@/components/layout/app-shell";
import { getDb } from "@/server/db/index";
import { anyWorkspaceHasBankCredentials } from "@/server/db/queries/bank-credentials";
import { getAppSettings } from "@/server/db/queries/settings";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("chat") };
}

function firstWorkspaceId(): number {
  const row = getDb().prepare("SELECT id FROM workspaces ORDER BY id LIMIT 1").get() as
    | { id: number }
    | undefined;
  if (!row) throw new Error("No workspace exists");
  return row.id;
}

export default async function ChatPage({ params }: { params: Promise<{ locale: string }> }) {
  if (!anyWorkspaceHasBankCredentials()) {
    const { locale } = await params;
    redirect(`/${locale}/setup`);
  }

  const settings = getAppSettings(firstWorkspaceId());
  const enabled = settings.aiProvider !== "none";

  return <AppShell>{enabled ? <ChatClient /> : <ChatDisabled />}</AppShell>;
}
