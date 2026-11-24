import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, PageHero } from "@/components/ui";
import { memberPreferences } from "@/lib/club/communications";
import { getLocale } from "@/lib/i18n/server";
import { communicationText } from "@/lib/i18n/communications";
import { hasSupabaseConfig } from "@/lib/supabase";
import { createServerSupabase } from "@/lib/supabase/server";
import { FeedbackForm, NotificationPreferencesForm } from "./forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: communicationText(await getLocale(), "title"), robots: { index: false, follow: false } };
}

export default async function ClubPreferencesPage() {
  const locale = await getLocale();
  if (!hasSupabaseConfig()) redirect("/login");
  const db = await createServerSupabase();
  const { data: user } = await db.auth.getUser();
  if (!user.user) redirect("/login");
  const { data } = await db.rpc("club_member_preferences");
  const preferences = memberPreferences.safeParse(data);
  return <>
    <PageHero title={communicationText(locale, "title")} subtitle={communicationText(locale, "lead")} />
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 sm:px-6">
      {preferences.success ? <>
        <NotificationPreferencesForm locale={locale} current={preferences.data.notifications} />
        <FeedbackForm locale={locale} current={preferences.data.feedback} />
      </> : <Card><p className="text-muted">{communicationText(locale, "temporarilyUnavailable")}</p></Card>}
    </div>
  </>;
}
