"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { append, bestHits, replay } from "@/lib/referee/guided/reducer";
import type { Action, Draft } from "@/lib/referee/guided/protocol";
import type { Locale } from "@/lib/i18n/messages";
import { Journal } from "@/app/referee/guided-referee";
import { PrivateRoster, RoleCorrection, Sheet } from "@/app/referee/live";
import { translate, type Word } from "@/app/referee/words";
import { reviewDraft } from "../actions";
import "@/app/referee/referee.css";

type Disposition = "approve" | "clarify" | "rejected" | "archived" | "correction";

export function Review({ id, draft, revision, status, game, note, players, locale }: {
  id: string; draft: Draft | null; revision: number; status: Word; game: string | null; note: string | null;
  players: { id: string; name: string }[]; locale: Locale;
}) {
  const t = translate(locale);
  const router = useRouter();
  const state = draft && replay(draft).state;
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Word | null>(null);
  const [reason, setReason] = useState("");
  const [host, setHost] = useState(draft?.host.id ?? "");
  const [panel, setPanel] = useState<"journal" | "correction" | "roles" | null>(null);
  const [receipt, setReceipt] = useState<string | null>(game);

  async function save(action: Disposition, correction?: Action) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const result = await reviewDraft({ id, revision, action, reason: correction && "reason" in correction ? correction.reason : reason,
        host: host || null, checked, correction });
      if (result.error) {
        setError(result.error === "host" ? "hostRequired" : result.error === "conflict" ? "conflict" : "reviewFailure");
        return false;
      }
      if (result.game) setReceipt(result.game);
      router.refresh();
      return true;
    } catch { setError("reviewFailure"); return false; }
    finally { setBusy(false); }
  }

  return <section className="ref-shell ref-inbox">
    <div className="ref-section">
      <div className="ref-row"><h2>{draft ? t(draft.format) + " · " + t("round") + " " + draft.round : t("invalid")}</h2><b>{t(receipt ? "approved" : status)}</b></div>
      {state?.result && <p className="ref-result">{t(state.result.outcome)} {state.result.technical && "· " + t("technicalResult")}</p>}
      {draft && <p>{t("host")} · {draft.host.name || "—"}</p>}
      {state?.result && <p>{state.result.basis}</p>}
      {state?.best && <p>{t("best")} · {state.best.join(", ")} · {t("hits")} {bestHits(state)}</p>}
      {note && <p className="ref-notice">{note}</p>}
      {state && state.gaps.length > 0 && <ul>{[...new Set(state.gaps)].map((gap) => <li key={gap}>{t(gap as Word)}</li>)}</ul>}
      {draft && state && <div className="ref-actions">
        <button type="button" onClick={() => setPanel("roles")}>{t("private")}</button>
        <button type="button" onClick={() => setPanel("journal")}>{t("journal")}</button>
        {status === "submitted" && <button type="button" onClick={() => setPanel("correction")}>{t("roleSwap")}</button>}
      </div>}
      {receipt && <Link className="inline-flex min-h-11 items-center text-accent-text underline" href={"/history/games/" + receipt}>{t("viewGame")}</Link>}
    </div>
    {!receipt && ["submitted", "clarify"].includes(status) && <div className="ref-section">
      {state?.result && state.result.outcome !== "cancelled" && <>
        {!draft?.host.id && <label>{t("hostOptional")}
          <select value={host} onChange={(e) => setHost(e.target.value)}>
            <option value="">—</option>
            {players.filter((p) => !draft?.players.some((s) => s.id === p.id)).map((p) =>
              <option value={p.id} key={p.id}>{p.name}</option>)}
          </select>
        </label>}
        <label className="ref-check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />{t("reviewGaps")}</label>
        <button type="button" className="primary" disabled={!checked || busy || status !== "submitted"} onClick={() => save("approve")}>{t("approve")}</button>
      </>}
      <label>{t("reason")}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
      <div className="ref-actions">
        <button type="button" disabled={reason.trim().length < 3 || busy} onClick={() => save("clarify")}>{t("request")}</button>
        <button type="button" disabled={reason.trim().length < 3 || busy} onClick={() => save("rejected")}>{t("reject")}</button>
        {state?.result?.outcome === "cancelled" &&
          <button type="button" disabled={reason.trim().length < 3 || busy} onClick={() => save("archived")}>{t("archive")}</button>}
        {state && status === "submitted" &&
          <button type="button" disabled={reason.trim().length < 3 || busy} onClick={() => save("correction", { type: "note", reason })}>{t("note")}</button>}
      </div>
    </div>}
    {error && <p role="alert" className="ref-notice">{t(error)}</p>}
    {panel === "roles" && draft && state && <Sheet title={t("private")} close={() => setPanel(null)}>
      <PrivateRoster draft={draft} state={state} t={t} />
    </Sheet>}
    {panel === "journal" && draft && <Sheet title={t("journal")} close={() => setPanel(null)}>
      <Journal draft={draft} t={t} locale={locale} />
    </Sheet>}
    {panel === "correction" && draft && state && <RoleCorrection draft={draft} state={state} t={t} close={() => setPanel(null)}
      act={async (action) => await save("correction", action) ? append(draft, action) : null} />}
  </section>;
}
