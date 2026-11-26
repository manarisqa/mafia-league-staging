import type { Metadata } from "next";
import { Card } from "@/components/ui";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";
import { feedbackSummary, notificationLog } from "@/lib/club/communications";
import { fullDateTime } from "@/lib/format";
import { communicationText, type CommunicationLabel } from "@/lib/i18n/communications";
import { getLocale } from "@/lib/i18n/server";
import { PreviewForm } from "./preview-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: communicationText(await getLocale(), "adminTitle") };
}

function communicationEvenings(supabase: SupabaseClient) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString();
  const future = supabase.from("evenings").select("id,starts_at,place,status")
    .eq("status", "planned").gte("starts_at", weekAgo).order("starts_at").limit(30);
  const recent = supabase.from("evenings").select("id,starts_at,place,status")
    .in("status", ["finished", "cancelled"]).gte("starts_at", weekAgo).order("starts_at", { ascending: false }).limit(30);
  return Promise.all([future, recent]);
}

export default async function AdminCommunicationsPage() {
  const locale = await getLocale();
  const t = (key: CommunicationLabel) => communicationText(locale, key);
  const { supabase } = await requireAdmin();
  const [[futureEvenings, recentEvenings], rawLog, rawSummary] = await Promise.all([
    communicationEvenings(supabase), supabase.rpc("club_notification_log"), supabase.rpc("club_feedback_summary"),
  ]);
  const options = [...(futureEvenings.data ?? []), ...(recentEvenings.data ?? [])].map((event) => ({
    id: event.id,
    label: `${fullDateTime(event.starts_at, locale)} · ${event.place} · ${t(event.status as "planned" | "finished" | "cancelled")}`,
  }));
  const log = notificationLog.safeParse(rawLog.data);
  const summary = feedbackSummary.safeParse(rawSummary.data);
  const feedbackGroups = summary.success ? [
    { label: "reasons", rows: summary.data.reasons },
    { label: "days", rows: summary.data.days },
  ] as const : [];

  return <div className="space-y-6">
    <div>
      <h1 className="font-display text-3xl font-bold">{t("adminTitle")}</h1>
      <p className="mt-2 text-muted">{t("adminLead")}</p>
    </div>
    <Card title={t("previewTitle")}>
      {futureEvenings.error || recentEvenings.error || !log.success ? <p className="text-muted">{t("temporarilyUnavailable")}</p>
        : <PreviewForm locale={locale} evenings={options} />}
    </Card>
    <Card title={t("log")}>
      {!log.success ? <p className="text-muted">{t("temporarilyUnavailable")}</p>
        : log.data.length === 0 ? <p className="text-muted">{t("logEmpty")}</p>
          : <ul className="divide-y divide-border">
            {log.data.map((row, index) => (
              <li key={`${row.simulated_at}:${row.category}:${index}`} className="grid gap-1 py-3 text-sm sm:grid-cols-3">
                <div className="min-w-0 break-words">
                  <p><b>{t(row.category)}</b> · {row.place}</p>
                  <p className="text-muted">{fullDateTime(row.starts_at, locale)}</p>
                </div>
                <p className="text-muted">{t("simulationAt")} · {fullDateTime(row.simulated_at, locale)}</p>
                <p className="text-muted">{t("countRecipient")} · {row.recipients}</p>
              </li>
            ))}
          </ul>}
    </Card>
    <Card title={t("summary")}>
      <p className="text-sm text-muted">{t("summaryHelp")}</p>
      {!summary.success ? <p className="mt-3 text-muted">{t("temporarilyUnavailable")}</p>
        : Object.values(summary.data).every((rows) => rows.length === 0) ? <p className="mt-3 text-muted">{t("summaryEmpty")}</p>
          : <div className="mt-4 space-y-4">
            {summary.data.scores.length > 0 && <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {summary.data.scores.map((score) => (
                <div key={score.key} className="rounded-panel bg-elevated p-3">
                  <dt>{t(score.key)}</dt>
                  <dd className="mt-1 font-display text-xl tabular-nums">{score.average.toLocaleString(locale)} / 5</dd>
                  <dd className="text-sm text-muted">{t("responses")} · {score.responses}</dd>
                </div>
              ))}
            </dl>}
            <div className="grid gap-3 sm:grid-cols-2">
              {feedbackGroups.filter(({ rows }) => rows.length > 0).map(({ label, rows }) => (
                <section key={label}>
                  <h3 className="font-medium">{t(label)}</h3>
                  <dl className="mt-1 divide-y divide-border">
                    {rows.map((row) => (
                      <div key={row.key} className="flex justify-between gap-3 py-2 text-sm">
                        <dt>{t(row.key)}</dt><dd className="text-muted">{row.responses}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
            {summary.data.suggestions.length > 0 && <section>
              <h3 className="font-medium">{t("suggestion")}</h3>
              <ul className="mt-2 divide-y divide-border">
                {summary.data.suggestions.map((suggestion, index) => (
                  <li key={index} className="py-2 text-sm break-words whitespace-pre-wrap">{suggestion}</li>
                ))}
              </ul>
            </section>}
          </div>}
    </Card>
  </div>;
}
