import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { fullDateTime } from "@/lib/format";
import { translate, type Word } from "@/app/referee/words";

export default async function Inbox() {
  const [{ supabase }, locale] = await Promise.all([requireAdmin(), getLocale()]);
  const t = translate(locale);
  const { data, error } = await supabase.from("guided_referee_drafts")
    .select("id,status,format,round_no,submitted_at,game_id,evening_id")
    .order("submitted_at", { ascending: false }).limit(250);
  const { data: evenings } = data?.length ? await supabase.from("evenings").select("id,place,starts_at")
    .in("id", [...new Set(data.map((entry) => entry.evening_id))]) : { data: [] };

  return <section className="space-y-4">
    <h1 className="font-display text-3xl font-bold">{t("inbox")}</h1>
    {error ? <p role="alert" className="text-warning">{t("unavailable")}</p> : !data?.length ? <p className="text-muted">{t("noInbox")}</p> :
      <ul className="grid gap-2">{[...data].sort((a, b) => Number(["submitted", "clarify"].includes(b.status)) - Number(["submitted", "clarify"].includes(a.status)))
        .map((row) => {
          const evening = evenings?.find((e) => e.id === row.evening_id);
          return <li key={row.id}>
            <Link href={"/admin/referee/inbox/" + row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-surface p-4 hover:border-accent-text">
              <span><b>{t(row.format as Word)} · {t("round")} {row.round_no}</b>
                <small className="block text-muted">{evening?.place ?? t("evening")} · {fullDateTime(evening?.starts_at ?? row.submitted_at, locale)}</small>
              </span>
              <span className="rounded-control border border-border px-3 py-2 text-sm">{t(row.status as Word)}</span>
            </Link>
          </li>;
        })}</ul>}
  </section>;
}
