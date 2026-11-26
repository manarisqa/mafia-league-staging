import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { adminPlayers } from "@/lib/admin-data";
import { getLocale } from "@/lib/i18n/server";
import { validate } from "@/lib/referee/guided/reducer";
import { fullDateTime } from "@/lib/format";
import { translate, type Word } from "@/app/referee/words";
import { Review } from "./review";

export default async function DraftPage({ params }: PageProps<"/admin/referee/inbox/[id]">) {
  const [{ supabase }, { id }, locale] = await Promise.all([requireAdmin(), params, getLocale()]);
  if (!z.guid().safeParse(id).success) notFound();
  const t = translate(locale);
  const [record, players, history] = await Promise.all([
    supabase.from("guided_referee_drafts").select("id,status,revision,payload,game_id,review_note,evening_id").eq("id", id).maybeSingle(),
    adminPlayers(supabase),
    supabase.from("guided_referee_versions").select("revision,kind,created_at,reason").eq("draft_id", id).order("revision"),
  ]);
  if (!record.data) notFound();
  const row = record.data;
  const { data: evening } = await supabase.from("evenings").select("place,starts_at").eq("id", row.evening_id).maybeSingle();
  let submission = null;
  try { submission = validate(row.payload); } catch { /* Invalid untrusted records can still be rejected. */ }
  return <div className="space-y-4">
    <Link className="inline-flex min-h-11 items-center text-accent-text underline" href="/admin/referee/inbox">{t("inbox")}</Link>
    <h1 className="font-display text-3xl font-bold">{t("review")}</h1>
    {evening && <p className="text-muted">{evening.place} · {fullDateTime(evening.starts_at, locale)}</p>}
    <Review key={row.revision} id={id} draft={submission?.draft ?? null} revision={row.revision} status={row.status}
      game={row.game_id} note={row.review_note} players={players.map((p) => ({ id: p.id, name: p.nickname?.trim() || p.display_name }))} locale={locale} />
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="font-semibold">{t("priorVersions")}</h2>
      <ol className="mt-2 space-y-2">
        {history.data?.map((item) => <li key={item.revision}>{item.revision} · {t((item.kind === "correction" ? "correction" : item.kind) as Word)} · {fullDateTime(item.created_at, locale)}
          {item.reason && <p className="text-muted">{item.reason}</p>}
        </li>)}
      </ol>
    </section>
  </div>;
}
