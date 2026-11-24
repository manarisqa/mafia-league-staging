"use client";

import { useEffect, useMemo, useState } from "react";
import { FAIR_QUEUE, FAIR_SEAT, PROCEDURE, formats, seatCount, type Availability, type Catalog, type Draft, type Format, type Player } from "@/lib/referee/guided/protocol";
import { fairSeats, historyAt, queue, type AvailabilityRow } from "@/lib/referee/guided/fair";
import { fullDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n/messages";
import { Board } from "./board";
import type { Translate } from "./words";

export function playerLabel(player: Player, players: Player[], t: Translate) {
  const same = players.filter((p) => p.name.trim().toLocaleLowerCase() === player.name.trim().toLocaleLowerCase());
  return same.length > 1 ? player.name + " · " + t("duplicate") + " " + (same.indexOf(player) + 1) : player.name;
}

type Seats = {
  original: string[]; confirmed: string[]; cut: string; eligibleGames: string[]; swaps: Draft["organization"]["swaps"];
};
type SetupCache = {
  eveningId: string; format: Format; hostId: string | null; customHost: string; hostMode: boolean;
  attendance: AvailabilityRow[]; screen: "attendance" | "roster" | "seats"; proposal: string[];
  roster: string[]; reason: string; seatDraft: Seats | null; abandoned: NonNullable<Draft["organization"]["abandoned"]>;
};

function restoreSetup(key: string): SetupCache | null {
  try { return JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { return null; }
}

export function Setup({ catalog, locale, t, last, localRounds, onStart }: {
  catalog: Catalog; locale: Locale; t: Translate; last: Draft | null; localRounds: Draft[];
  onStart: (draft: Draft) => Promise<boolean>;
}) {
  const key = "mafia.guided.setup." + (last?.id ?? "initial");
  const [saved] = useState(() => {
    const cached = restoreSetup(key);
    return catalog.evenings.some((item) => item.id === cached?.eveningId) ? cached : null;
  });
  const [continuing] = useState(last && catalog.evenings.some((item) => item.id === last.evening) ? last : null);
  const [eveningId, setEvening] = useState(saved?.eveningId ?? continuing?.evening ?? catalog.evenings[0]?.id ?? "");
  const [format, setFormat] = useState<Format>(saved?.format ?? last?.format ?? "classic10");
  const [hostId, setHost] = useState<string | null>(saved?.hostId ?? continuing?.host.id ?? null);
  const [customHost, setCustomHost] = useState(saved?.customHost ?? continuing?.host.name ?? "");
  const [hostMode, setHostMode] = useState(saved?.hostMode ?? !!continuing?.host.id);
  const [attendance, setAttendance] = useState<AvailabilityRow[]>(saved?.attendance ?? continuing?.organization.attendance ?? []);
  const [search, setSearch] = useState("");
  const [screen, setScreen] = useState<"attendance" | "roster" | "seats">(saved?.screen ?? "attendance");
  const [proposal, setProposal] = useState<string[]>(saved?.proposal ?? []);
  const [roster, setRoster] = useState<string[]>(saved?.roster ?? []);
  const [reason, setReason] = useState(saved?.reason ?? "");
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seatDraft, setSeatDraft] = useState<Seats | null>(saved?.seatDraft ?? null);
  const [abandoned, setAbandoned] = useState<NonNullable<Draft["organization"]["abandoned"]>>(saved?.abandoned ?? []);
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify({ eveningId, format, hostId, customHost, hostMode,
      attendance, screen, proposal, roster, reason, seatDraft, abandoned } satisfies SetupCache)); }
    catch { /* The active draft is saved separately. */ }
  }, [key, eveningId, format, hostId, customHost, hostMode, attendance, screen, proposal, roster, reason, seatDraft, abandoned]);
  const [take, setTake] = useState<number[]>([]);
  const [swapReason, setSwapReason] = useState("");
  const evening = catalog.evenings.find((e) => e.id === eveningId);
  const size = seatCount(format);
  const status = useMemo(() => new Map(attendance.map((p) => [p.id, p.status])), [attendance]);
  const host = hostMode ? hostId ?? evening?.host ?? null : null;
  const roundHistory = localRounds.filter((d) => d.evening === evening?.id);
  const round = Math.max(evening?.round ?? 1, ...roundHistory.map((g) => g.round + 1));
  const visible = catalog.players.filter((p) => p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const candidates = attendance.filter((p) => p.id !== host && ["ready", "observe"].includes(p.status));
  const hostName = catalog.players.find((p) => p.id === host)?.name ?? customHost.trim();
  const edited = proposal.length !== roster.length || roster.some((id) => !proposal.includes(id));
  const changedSeats = !!seatDraft && !seatDraft.original.every((id) => roster.includes(id));
  const byId = new Map(catalog.players.map((p) => [p.id, p]));

  const changeStatus = (id: string, value: Availability) => setAttendance((list) =>
    [...list.filter((p) => p.id !== id), ...(value === "left" ? [] : [{ id, status: value }])]);

  function propose(reuse = false) {
    const prior = roundHistory.map((d) => ({ attendance: d.organization.attendance, host: d.host.id, players: d.players.map((p) => p.id) }));
    const result = queue(catalog.players, attendance, host, format, prior);
    if (result.length < size && candidates.length < size) { setError(true); return; }
    const reused = continuing?.players.map((p) => p.id).filter((id) => candidates.some((p) => p.id === id)) ?? [];
    setProposal(result);
    setRoster(reuse ? reused.slice(0, size) : result);
    setReason(reuse ? t("sameRoster") : "");
    setError(false);
    setScreen("roster");
  }

  function assign() {
    if (seatDraft && !changedSeats) { setScreen("seats"); return; }
    if (seatDraft) setAbandoned((list) => [...list, {
      roster: seatDraft.original, cut: seatDraft.cut, eligibleGames: seatDraft.eligibleGames, swaps: seatDraft.swaps, reason: reason.trim(),
    }]);
    const cut = new Date().toISOString();
    const eligible = historyAt(catalog.history, format, cut, roster);
    const ordered = fairSeats(roster, format, eligible);
    setSeatDraft({ original: ordered, confirmed: ordered, cut, eligibleGames: eligible.map((g) => g.id), swaps: [] });
    setScreen("seats");
  }

  function swap() {
    if (!seatDraft || take.length !== 2) return;
    const [first, second] = take;
    const confirmed = [...seatDraft.confirmed];
    [confirmed[first - 1], confirmed[second - 1]] = [confirmed[second - 1], confirmed[first - 1]];
    setSeatDraft({ ...seatDraft, confirmed,
      swaps: [...seatDraft.swaps, { first, second, reason: swapReason.trim(), at: new Date().toISOString() }] });
    setTake([]);
    setSwapReason("");
  }

  async function start() {
    if (!evening || !seatDraft || saving || take.length === 2 || seatDraft.confirmed.some((id) => !byId.has(id))) return;
    setSaving(true);
    const started = await onStart({
      id: crypto.randomUUID(), version: PROCEDURE, evening: evening.id, round, format,
      startedAt: new Date().toISOString(), host: { id: host, name: hostName },
      players: seatDraft.confirmed.map((id) => ({ id, name: byId.get(id)!.name })),
      organization: {
        attendance, queue: FAIR_QUEUE, proposed: proposal, override: edited ? reason.trim() : null,
        seats: FAIR_SEAT, cut: seatDraft.cut, eligibleGames: seatDraft.eligibleGames,
        original: seatDraft.original, swaps: seatDraft.swaps, ...(abandoned.length ? { abandoned } : {}),
      },
      events: [],
    });
    if (started) { try { sessionStorage.removeItem(key); } catch { /* Optional cache. */ } }
    setSaving(false);
  }

  if (!evening) return null;

  return (
    <div className="ref-setup">
      <div className="ref-banner">
        <span>{t("evening")} · {t("round")} {round}</span>
        <h2>{screen === "attendance" ? t("participants") : screen === "roster" ? t("roster") : t("seatingTitle")}</h2>
        <p>{evening.place} · {fullDateTime(evening.startsAt, locale)}</p>
      </div>
      {screen === "attendance" && (
        <>
          <div className="ref-form-grid">
            <label>{t("evening")}
              <select value={evening.id} onChange={(e) => {
                const target = catalog.evenings.find((v) => v.id === e.target.value);
                setEvening(e.target.value); setAttendance([]); setHost(target?.host ?? null); setHostMode(!!target?.host); setCustomHost(""); setSeatDraft(null); setAbandoned([]);
              }}>
                {catalog.evenings.map((item) => <option key={item.id} value={item.id}>{item.place} · {fullDateTime(item.startsAt, locale)}</option>)}
              </select>
            </label>
            <fieldset><legend>{t("format")}</legend>
              <div className="ref-actions">
                {formats.map((kind) => <button type="button" className={format === kind ? "chosen" : ""} key={kind}
                  aria-pressed={format === kind} onClick={() => setFormat(kind)}>{t(kind)} · {seatCount(kind)}</button>)}
              </div>
            </fieldset>
            <label>{t("host")}
              {hostMode ? <select value={host ?? ""} onChange={(e) => setHost(e.target.value || null)}>
                <option value="">{t("fromRegistry")}</option>
                {catalog.players.map((p) => <option value={p.id} key={p.id}>{playerLabel(p, catalog.players, t)}</option>)}
              </select> : <input value={customHost} maxLength={64} placeholder={t("hostName")} onChange={(e) => setCustomHost(e.target.value)} />}
            </label>
            <button type="button" onClick={() => { setHostMode(!hostMode); setHost(null); }}>
              {hostMode ? t("hostName") : t("fromRegistry")}
            </button>
          </div>
          <div className="ref-section">
            <div className="ref-row"><h3>{t("attendance")}</h3><b>{candidates.length} / {size}</b></div>
            {evening.confirmed.length > 0 && <div className="ref-rsvp">
              <p>{t("rsvpHint")}</p>
              <button type="button" onClick={() => setAttendance((rows) => [
                ...rows, ...evening.confirmed.filter((id) => id !== host && !rows.some((p) => p.id === id))
                  .map((id) => ({ id, status: "ready" as const })),
              ])}>{t("rsvp")}</button>
            </div>}
            <input placeholder={t("search")} aria-label={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="ref-roster">
              {visible.map((p) => <div className="ref-roster-row" key={p.id}>
                <button type="button" disabled={p.id === host} aria-pressed={status.get(p.id) === "ready"}
                  onClick={() => changeStatus(p.id, status.get(p.id) === "ready" ? "left" : "ready")}>{playerLabel(p, catalog.players, t)}</button>
                {p.id === host ? <span>{t("host")}</span> : <select aria-label={playerLabel(p, catalog.players, t)}
                  value={status.get(p.id) ?? "left"} onChange={(e) => changeStatus(p.id, e.target.value as Availability)}>
                  <option value="left">{t("left")}</option><option value="ready">{t("ready")}</option>
                  {p.novice && <option value="observe">{t("observe")}</option>}
                  <option value="pause">{t("pause")}</option>
                </select>}
              </div>)}
            </div>
          </div>
          {error && <p role="alert" className="ref-notice">{t("tooFew")}</p>}
          <div className="ref-actions">
            <button type="button" className="primary" onClick={() => propose()}>{t("choose")}</button>
            {continuing?.evening === eveningId && <button type="button" onClick={() => propose(true)}>{t("sameRoster")}</button>}
          </div>
        </>
      )}
      {screen === "roster" && (
        <div className="ref-section">
          <div className="ref-row"><p>{t("rosterHint")}</p><b>{roster.length} / {size}</b></div>
          <div className="ref-roster">
            {candidates.map(({ id }) => {
              const item = byId.get(id);
              if (!item) return null;
              const selected = roster.includes(id);
              return <button type="button" key={id} aria-pressed={selected} className={selected ? "chosen" : ""}
                disabled={!selected && roster.length >= size}
                onClick={() => setRoster((list) => selected ? list.filter((p) => p !== id) : [...list, id])}>
                {playerLabel(item, catalog.players, t)} · {t(selected ? "included" : "excluded")}
              </button>;
            })}
          </div>
          {(edited || changedSeats) && <label>{t("manualChange")}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>}
          <div className="ref-actions">
            <button type="button" disabled={!!seatDraft} onClick={() => setScreen("attendance")}>{t("back")}</button>
            <button type="button" className="primary" disabled={roster.length !== size || ((edited || changedSeats) && reason.trim().length < 3)}
              onClick={assign}>{t("sit")}</button>
          </div>
        </div>
      )}
      {screen === "seats" && seatDraft && (
        <div className="ref-section">
          <p>{t("seatingHint")}</p>
          <Board players={seatDraft.confirmed.map((id) => byId.get(id) ?? { name: "—" })} format={format} t={t} selected={take}
            onSeat={(n) => setTake((prior) => prior.includes(n) ? prior.filter((x) => x !== n) : prior.length === 2 ? [n] : [...prior, n])} />
          {take.length === 2 && <>
            <label>{t("reason")}<input value={swapReason} maxLength={500} onChange={(e) => setSwapReason(e.target.value)} /></label>
            <button type="button" disabled={swapReason.trim().length < 3} onClick={swap}>{t("changeSeats")}</button>
          </>}
          <div className="ref-actions">
            <button type="button" onClick={() => { setTake([]); setSwapReason(""); setScreen("roster"); }}>{t("back")}</button>
            <button type="button" className="primary" disabled={saving || take.length === 2 || seatDraft.confirmed.some((id) => !byId.has(id))} onClick={start}>{t("confirmSeats")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
