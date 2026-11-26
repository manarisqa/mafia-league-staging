"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LanguageSwitch, useTranslation } from "@/components/locale-provider";
import { fullDateTime } from "@/lib/format";
import { emptyCatalog, inEveningWindow, type Action, type Catalog, type Draft } from "@/lib/referee/guided/protocol";
import { append, bestHits, replay, validate } from "@/lib/referee/guided/reducer";
import { derive, type Draft as OldDraft } from "@/lib/referee/engine";
import { canonical } from "@/lib/league/legacy/referee-protocol";
import { Live, PrivateRoster, RoleCorrection, Sheet, UndoRedo } from "./live";
import { Setup } from "./setup";
import {
  activeKey, catalogKey, clearClocks, cloud, download, get, importFile, isDraftChange, list, mergeRecoveredDraft, newLocal, read,
  reconcileRestarts, recoverProtected, restartLocal, restoreWithCode, save, slotOf, wasCancelled,
  withCloudLock, write, type LocalDraft,
} from "./local";
import { checkLabel, translate, type Translate, type Word } from "./words";

type Panel = "more" | "restore" | "code" | "correction" | "roles" | "journal" | "note" | "restart";
const errors: Record<string, Word> = {
  invalid: "invalid", invalid_procedure: "invalid", denied: "denied", conflict: "conflict", unavailable: "unavailable",
  rate: "rate", round: "roundConflict", localConflict: "localConflict", QuotaExceededError: "storage", SecurityError: "storage",
  restartProtected: "restartProtected",
};

type CatalogStatus = "loading" | "ready" | "offline" | "failed";

function isCatalog(value: unknown): value is Catalog {
  if (!value || typeof value !== "object") return false;
  return "evenings" in value && Array.isArray(value.evenings) && "players" in value && Array.isArray(value.players)
    && "history" in value && Array.isArray(value.history);
}

function playedRounds(sessions: LocalDraft[]) {
  const rounds = new Map<string, LocalDraft>();
  const priority = (status: LocalDraft["status"]) => status === "approved" ? 2 : status === "draft" ? 0 : 1;
  for (const record of sessions) {
    const { draft, status, cancellations } = record;
    if (["rejected", "revoked", "archived"].includes(status) || cancellations?.some((entry) => entry.state === "protected")) continue;
    // Portable JSON carries no cloud receipt. It might predate a restart on the source device.
    if (record.fromFile && record.synced < 0) continue;
    const key = draft.evening + ":" + draft.round;
    const known = rounds.get(key);
    if (known && priority(known.status) >= priority(status)) continue;
    const result = replay(draft).state.result;
    if (result && result.outcome !== "cancelled") rounds.set(key, record);
  }
  return [...rounds.values()].map(({ draft }) => draft).sort((a, b) => a.round - b.round);
}

export function GuidedReferee({ adminEvenings }: { adminEvenings?: ReactNode }) {
  const { locale: siteLocale } = useTranslation();
  const [offlineLocale, setOfflineLocale] = useState<"ru" | "uk" | null>(null);
  const locale = offlineLocale ?? siteLocale;
  const t = translate(locale);
  const [ready, setReady] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog);
  const [online, setOnline] = useState(true);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>("loading");
  const catalogRequest = useRef<AbortController | null>(null);
  const [current, setCurrent] = useState<LocalDraft | null>(null);
  const [next, setNext] = useState<Draft | null>(null);
  const [sessions, setSessions] = useState<LocalDraft[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [legacy, setLegacy] = useState<OldDraft | null>(null);
  const [warning, setWarning] = useState<Word | null>(null);
  const [notice, setNotice] = useState<Word | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [note, setNote] = useState("");
  const [restore, setRestore] = useState("");
  const game = current ? replay(current.draft) : null;
  const state = game?.state;
  const latest = current?.draft.events.find((event) => event.id === game?.undo);
  const evening = catalog.evenings.find((e) => e.id === current?.draft.evening);
  const protectedStatus = current && !["draft", "clarify"].includes(current.status);
  const restartBlocked = current?.cancellations?.some((entry) => entry.state === "protected");
  const mayRestart = current?.status === "draft" && !restartBlocked;
  const draftStatus = current?.outbox ? "outbox" : current?.status !== "draft" ? current?.status :
    current.synced === current.draft.events.length ? "cloud" : "local";

  const pullCatalog = useCallback(async () => {
    catalogRequest.current?.abort();
    if (!navigator.onLine) {
      const cached = read<unknown>(catalogKey);
      const now = Date.now();
      setCatalog(isCatalog(cached)
        ? { ...cached, evenings: cached.evenings.filter((item) => inEveningWindow(item?.startsAt, now)) } : emptyCatalog);
      setCatalogStatus("offline");
      return;
    }
    const request = new AbortController();
    catalogRequest.current = request;
    setCatalogStatus((prior) => prior === "ready" ? prior : "loading");
    const timeout = setTimeout(() => request.abort("timeout"), 12000);
    try {
      const response = await fetch("/api/referee/catalog", {
        cache: "no-store", credentials: "same-origin", signal: request.signal,
      });
      if (!response.ok) throw new Error();
      const content: unknown = await response.json();
      if (!isCatalog(content)) throw new Error();
      setCatalog(content);
      setCatalogStatus("ready");
      try { save(catalogKey, content); } catch { /* Optional cache. */ }
    } catch {
      if (catalogRequest.current === request && (!request.signal.aborted || request.signal.reason === "timeout")) setCatalogStatus("failed");
    } finally { clearTimeout(timeout); }
  }, []);

  const flushRestarts = useCallback((record: LocalDraft) => {
    if (!record.cancellations?.some((entry) => entry.state === "pending") || !navigator.onLine) return;
    void withCloudLock(record, (latest) => reconcileRestarts(latest, async (value, serial) => {
      const saved = await write(value, serial);
      setCurrent((view) => view?.draft.id === saved.draft.id && view.serial === serial ? saved : view);
      setSessions(list());
      return saved;
    })).catch(() => { /* Local play stays available. An explicit sync also retries the cancellation. */ });
  }, []);

  useEffect(() => {
    const updateOnline = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) {
        for (const record of list()) flushRestarts(record);
        setOfflineLocale(null);
        try { save("mafia.guided.locale", siteLocale); } catch { /* Optional cache. */ }
      } else setOfflineLocale(read<"ru" | "uk">("mafia.guided.locale"));
      void pullCatalog();
    };
    const hydrate = requestAnimationFrame(() => {
      const id = read<string>(activeKey);
      if (id) setCurrent(get(id));
      setSessions(list());
      setReady(true);
      updateOnline();
    });
    const onStorage = (event: StorageEvent) => { if (isDraftChange(event.key)) setSessions(list()); };
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    window.addEventListener("storage", onStorage);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/referee/sw.js", { scope: "/referee" })
        .then(() => navigator.serviceWorker.ready)
        .then((worker) => worker.active?.postMessage({
          type: "prime", assets: performance.getEntriesByType("resource").map((e) => e.name),
        })).catch(() => undefined);
    }
    return () => {
      cancelAnimationFrame(hydrate);
      catalogRequest.current?.abort();
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("storage", onStorage);
    };
  }, [flushRestarts, pullCatalog, siteLocale]);

  useEffect(() => {
    if (!current) return;
    const followRestart = (event: StorageEvent) => {
      if (!isDraftChange(event.key)) return;
      const latest = get(slotOf(current));
      if (!latest || (latest.draft.id === current.draft.id && latest.status === current.status &&
        latest.cancellations?.some((entry) => entry.state === "protected") === restartBlocked)) return;
      setCurrent(latest);
      setPanel(null);
      setWarning(null);
    };
    window.addEventListener("storage", followRestart);
    return () => window.removeEventListener("storage", followRestart);
  }, [current, restartBlocked]);

  useEffect(() => {
    const hide = () => {
      setPanel((p) => p && ["correction", "roles", "journal", "code", "restore"].includes(p) ? null : p);
      setRestore("");
    };
    const hideOnBackground = () => { if (document.hidden) hide(); };
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", hideOnBackground);
    return () => { window.removeEventListener("blur", hide); document.removeEventListener("visibilitychange", hideOnBackground); };
  }, []);

  const fail = (error: unknown, fallback: Word = "invalid") => setWarning(
    error instanceof Error ? errors[error.message] ?? errors[error.name] ?? fallback : fallback,
  );

  async function run<T>(fn: () => Promise<T>) {
    if (pending.current) return null;
    pending.current = true;
    setBusy(true);
    setWarning(null);
    setNotice(null);
    try { return await fn(); }
    finally { pending.current = false; setBusy(false); }
  }

  async function accept(record: LocalDraft, serial: number | null, activate = false) {
    const result = await write(record, serial, activate);
    setCurrent(result);
    setSessions(list());
    return result;
  }

  async function act(action: Action) {
    if (!current || protectedStatus || current.outbox) return null;
    return run(async () => {
      try {
        const draft = append(current.draft, action);
        await accept({ ...current, draft }, current.serial);
        return draft;
      } catch (error) { fail(error); return null; }
    });
  }

  async function init(draft: Draft) {
    const result = await run(async () => {
      try {
        const verified = validate(draft).draft;
        await accept(newLocal(verified), null, true);
        setNext(null);
        setLegacy(null);
        window.scrollTo(0, 0);
        return true;
      } catch (error) { fail(error); return false; }
    });
    return result === true;
  }

  function selectDraft(record: LocalDraft) {
    try { save(activeKey, slotOf(record)); } catch { setWarning("storage"); }
    setCurrent(record);
    setPanel(null);
    setLegacy(null);
    setWarning(null);
    setNext(null);
  }

  async function sync(action: "save" | "submit" | "read" | "revoke", replace = false) {
    if (!current) return;
    await run(async () => {
      try {
        await withCloudLock(current, async (latest) => {
          let working = latest;
          if (action === "submit" && !working.outbox) working = await accept({ ...working, outbox: true }, working.serial);
          if (action === "save" || action === "submit") working = await reconcileRestarts(working, accept);
          const result = await cloud(action, working);
          if (result.error) {
            if (action === "submit" && !["unavailable", "rate"].includes(result.error)) {
              await accept({ ...working, outbox: false }, working.serial);
            }
            throw new Error(result.error);
          }
          let draft = working.draft;
          if (action === "read" && result.payload) {
            const remote = validate(result.payload).draft;
            if (!replace && canonical(remote) !== canonical(working.draft) &&
              (working.synced !== working.draft.events.length || result.status === "draft")) {
              throw new Error("conflict");
            }
            draft = remote;
          }
          await accept({ ...working, draft, revision: result.revision, status: result.status,
            note: result.note ?? null, synced: draft.events.length, outbox: false }, working.serial);
          setPanel(null);
        });
      } catch (error) { fail(error, "unavailable"); }
    });
  }

  async function restart() {
    if (!current || !mayRestart) return;
    const restarted = await run(async () => {
      try {
        return await withCloudLock(current, async (latest) => {
          const saved = await accept(restartLocal(latest), latest.serial);
          setPanel(null);
          try { clearClocks(latest.draft.id); } catch { /* The new attempt has its own timer keys. */ }
          window.scrollTo(0, 0);
          return saved;
        });
      } catch (error) { fail(error); return null; }
    });
    if (restarted) flushRestarts(restarted);
  }

  async function openOriginal() {
    if (!current) return;
    await run(async () => {
      try {
        await withCloudLock(current, async (latest) => {
          await accept(await recoverProtected(latest), latest.serial);
          setPanel(null);
        });
      } catch (error) { fail(error, "unavailable"); }
    });
  }

  async function recover() {
    await run(async () => {
      try {
        const value = await restoreWithCode(restore);
        if (wasCancelled(value.draft.id)) throw new Error("conflict");
        const earlier = get(value.draft.id);
        await accept(mergeRecoveredDraft(earlier, value), earlier?.serial ?? null, true);
        setRestore("");
        setPanel(null);
      } catch (error) { fail(error, "unavailable"); }
    });
  }

  async function upload(file: File) {
    await run(async () => {
      try {
        const data = await importFile(file);
        if (data.legacy) { setLegacy(data.legacy); setPanel(null); return; }
        const draft = data.draft!;
        if (wasCancelled(draft.id)) throw new Error("conflict");
        const earlier = get(draft.id);
        if (earlier) {
          if (canonical(earlier.draft) !== canonical(draft)) throw new Error("conflict");
          selectDraft(earlier);
        } else {
          await accept({ ...newLocal(draft), fromFile: true }, null, true);
          setPanel(null);
        }
      } catch (error) { fail(error); }
    });
  }

  function leaveGame(continueEvening = false) {
    if (!current) return;
    try { save(activeKey, null); } catch { setWarning("storage"); return; }
    setNext(continueEvening ? current.draft : null);
    setCurrent(null);
    setPanel(null);
    void pullCatalog();
    window.scrollTo(0, 0);
  }

  const close = () => { setPanel(null); setRestore(""); };

  return <section className="ref-shell" data-referee>
    <div className="ref-topline">
      <Link href="/" aria-label="Mafia League" className="ref-brand"><i aria-hidden="true" /> <span>MAFIA LEAGUE</span></Link>
      <div className="ref-context">
        <h1>{t("hostGame")}</h1>
        {current && <span>{evening?.place ?? t("evening")} · {t("round")} {current.draft.round} · {t(current.draft.format)}</span>}
      </div>
      <div className="ref-sync" role="status">
        {!online && <span className="ref-offline">{t("offline")}</span>}
        {draftStatus && <span>{t(draftStatus)}</span>}
        {!current && <LanguageSwitch />}
      </div>
    </div>
    {warning && <div role="alert" className="ref-notice">
      {t(warning)}{warning === "localConflict" && current && <button type="button" onClick={() => {
        const latest = get(slotOf(current));
        if (latest) selectDraft(latest);
      }}>{t("reload")}</button>}
    </div>}
    {restartBlocked && <div className="ref-notice" role="status">
      {t("restartProtected")} <button type="button" disabled={busy || !online} onClick={openOriginal}>{t("openOriginal")}</button>
    </div>}
    {notice && <div role="status" className="ref-notice">{t(notice)}</div>}
    {!ready ? <p className="ref-notice">{t("wait")}</p> : legacy ?
      <Legacy draft={legacy} t={t} onClose={() => setLegacy(null)} /> :
      current && state ? state.result ?
        <div className="ref-review" data-step="review">
          <div className="ref-banner">
            <span>{fullDateTime(current.draft.startedAt, locale)} · {t(current.draft.format)}</span>
            <h2>{t("review")}</h2>
            <p>{current.status === "approved" ? t("approved") : t("reviewHint")}</p>
          </div>
          <div className="ref-section">
            <h3>{t(state.result.outcome)} {state.result.technical && "· " + t("technicalResult")}</h3>
            <p>{t("host")} · {current.draft.host.name || "—"}</p>
            <p>{state.result.basis}</p>
            {state.best && <p>{t("best")} · {state.best.join(", ")} · {t("hits")} {bestHits(state)}</p>}
            {state.gaps.length > 0 && <ul>{[...new Set(state.gaps)].map((gap) => <li key={gap}>{t(gap as Word)}</li>)}</ul>}
            {current.note && <p className="ref-notice">{current.note}</p>}
            {current.outbox && <p className="ref-notice">{t("reconnect")}</p>}
            <button type="button" onClick={() => setPanel("roles")}>{t("private")}</button>
          </div>
          <div className="ref-actions">
            {!restartBlocked && (!protectedStatus || current.outbox) &&
              <button type="button" className="primary" disabled={busy} onClick={() => sync("submit")}>{t("submit")}</button>}
            {current.revision > 0 && <button type="button" disabled={busy} onClick={() => sync("read")}>{t("refresh")}</button>}
            <button type="button" disabled={busy} className={protectedStatus || !online ? "primary" : ""} onClick={() => leaveGame(true)}>{t("nextGame")}</button>
            <button type="button" onClick={() => setPanel("more")}>{t("more")}</button>
          </div>
        </div> :
        <Live key={current.draft.id}
          draft={current.draft} state={state} t={t} act={act} latest={latest}
          tools={() => setPanel("more")} restart={mayRestart ? () => setPanel("restart") : undefined}
          disabled={busy || !!protectedStatus} />
      : <>
          {catalog.evenings.length > 0 && (catalogStatus === "ready" || catalogStatus === "offline") ? <>
            {catalogStatus === "offline" && <p className="ref-notice" role="status">{t("catalogCached")}</p>}
            <Setup key={(next?.id ?? "new") + ":" + catalog.evenings.map((item) => item.id).join(",")}
              catalog={catalog} locale={locale} t={t} last={next}
              localRounds={playedRounds(sessions)}
              onStart={init} />
          </> : <CatalogEntry status={catalogStatus} t={t} retry={pullCatalog} adminEvenings={adminEvenings} />}
          <div className="ref-section ref-drafts">
            {sessions.length > 0 && <><h3>{t("savedDrafts")}</h3>
              <div className="ref-roster">{sessions.map((record) => <button type="button" key={record.draft.id} onClick={() => selectDraft(record)}>
                {t(record.draft.format)} · {t("round")} {record.draft.round} · {fullDateTime(record.draft.startedAt, locale)} · {t(record.outbox ? "outbox" : record.status === "draft" ? "local" : record.status)}
              </button>)}</div>
            </>}
            <button type="button" onClick={() => setPanel("restore")}>{t("restore")}</button>
          </div>
        </>}
    {panel === "more" && current && state && <Sheet title={t("more")} close={close}>
      <div className="ref-actions">
        <button type="button" onClick={() => setPanel("journal")}>{t("journal")}</button>
        {state.phase !== "setup" && <button type="button" onClick={() => setPanel("roles")}>{t("private")}</button>}
        {mayRestart && <button type="button" disabled={busy} onClick={() => setPanel("restart")}>{t("restartGame")}</button>}
        {!protectedStatus && !current.outbox && <>
          {!restartBlocked && <button type="button" disabled={busy} onClick={() => sync("save")}>{t("save")}</button>}
          <button type="button" onClick={() => { setNote(""); setPanel("note"); }}>{t("note")}</button>
          {!state.result && <button type="button" onClick={() => setPanel("correction")}>{t("roleSwap")}</button>}
          <UndoRedo draft={current.draft} t={t} act={async (action) => { const draft = await act(action); if (draft) close(); return draft; }} />
        </>}
        <button type="button" onClick={() => void download(current.draft).catch(() => setWarning("storage"))}>{t("export")}</button>
        <button type="button" disabled={busy} onClick={() => leaveGame()}>{t("leaveGame")}</button>
        {current.revision > 0 && <>
          <button type="button" onClick={() => setPanel("code")}>{t("showCode")}</button>
          <button type="button" disabled={busy} onClick={() => { if (window.confirm(t("restoreConfirm"))) void sync("read", true); }}>{t("restoreRemote")}</button>
        </>}
      </div>
    </Sheet>}
    {panel === "restart" && mayRestart && <Sheet title={t("restartGame")} close={close}>
      <p>{t("restartConfirm")}</p>
      <div className="ref-actions">
        <button type="button" autoFocus onClick={close}>{t("back")}</button>
        <button type="button" className="primary" disabled={busy} onClick={restart}>{t("restartGame")}</button>
      </div>
    </Sheet>}
    {panel === "note" && <Sheet title={t("note")} close={close}>
      <label>{t("reason")}<input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
      <button type="button" className="primary" disabled={note.trim().length < 3 || busy}
        onClick={async () => { if (await act({ type: "note", reason: note })) close(); }}>{t("next")}</button>
    </Sheet>}
    {panel === "roles" && current && state && <Sheet title={t("private")} close={close}>
      <PrivateRoster draft={current.draft} state={state} t={t} />
    </Sheet>}
    {panel === "correction" && current && state && <RoleCorrection draft={current.draft} state={state} t={t} act={act} close={close} />}
    {panel === "journal" && current && <Sheet title={t("journal")} close={close}>
      <Journal draft={current.draft} t={t} locale={locale} />
    </Sheet>}
    {panel === "code" && current && <Sheet title={t("recoverCloud")} close={close}>
      <p>{t("privateUse")}</p>
      <input readOnly aria-label={t("recoverCloud")} value={current.draft.id + "." + current.secret} />
      <div className="ref-actions">
        <button type="button" onClick={() => {
          void navigator.clipboard.writeText(current.draft.id + "." + current.secret)
            .then(() => { close(); setNotice("codeCopied"); }).catch(() => setWarning("storage"));
        }}>{t("copyCode")}</button>
        <button type="button" disabled={busy} onClick={() => { if (window.confirm(t("revokeConfirm"))) void sync("revoke"); }}>{t("revoke")}</button>
      </div>
    </Sheet>}
    {panel === "restore" && <Sheet title={t("restore")} close={close}>
      <label>{t("recoverCloud")}<input type="password" autoComplete="off" value={restore} onChange={(e) => setRestore(e.target.value)} /></label>
      <button type="button" disabled={!restore || busy} onClick={recover}>{t("restore")}</button>
      <input type="file" accept=".json,application/json" aria-label="JSON" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
    </Sheet>}
  </section>;
}

function CatalogEntry({ status, t, retry, adminEvenings }: {
  status: CatalogStatus; t: Translate; retry: () => void; adminEvenings?: ReactNode;
}) {
  const title = { loading: "catalogLoading", ready: "noEvening", offline: "catalogOffline", failed: "catalogFailed" } as const;
  const help = { ready: "noEveningHelp", offline: "catalogOfflineHelp", failed: "catalogFailedHelp" } as const;
  return <div className="ref-banner ref-entry" data-catalog-state={status} aria-busy={status === "loading"}>
    <div role={status === "failed" ? "alert" : "status"}>
      <h2>{t(title[status])}</h2>
      {status !== "loading" && <p>{t(help[status])}</p>}
    </div>
    <div className="ref-actions">
      {status !== "loading" && <button type="button" className="primary" onClick={retry}>{t("catalogRetry")}</button>}
      <Link className="ref-link" href="/evenings">{t("games")}</Link>
      {status === "ready" && adminEvenings}
    </div>
  </div>;
}

const journalLabels: Record<Action["type"], Word> = {
  role: "roles", roleSwap: "roleSwap", advance: "next", speechStart: "speech", nominate: "nominate",
  discipline: "discipline", count: "count", confirmVote: "confirmVote", joint: "joint", shot: "shot",
  shotNone: "shot", check: "nightWindow", best: "best", finish: "finish", exception: "technicalResult",
  note: "note", undo: "undo", redo: "redo",
};

export function Journal({ draft, locale, t }: { draft: Draft; locale: "ru" | "uk"; t: Translate }) {
  return <ol className="ref-journal">{draft.events.map(({ id, at, action }, index) => <li key={id}>
    <span>{index + 1}. {t(journalLabels[action.type])} · {new Date(at).toLocaleTimeString(locale)}</span>
    {"reason" in action && action.reason && <small>{action.reason}</small>}
    {"seat" in action && <small>№{action.seat}</small>}
    {"seconds" in action && action.seconds !== null && <small>{action.seconds} с</small>}
    {action.type === "check" && <small>{action.target ? "№" + action.target + " · " : ""}
      {t(action.answer ? checkLabel(action.answer) : action.mode === "observed" ? "nightWindow" : action.mode)}</small>}
    {action.type === "shot" && <small>№{action.target}</small>}
    {action.type === "shotNone" && <small>{t(action.mode)}</small>}
    {action.type === "count" && <small>{action.value}</small>}
    {action.type === "joint" && <small>{action.yes}</small>}
  </li>)}</ol>;
}

function Legacy({ draft, onClose, t }: { draft: OldDraft; onClose: () => void; t: Translate }) {
  const table = derive(draft);
  return <div className="ref-section">
    <h2>{t("legacy")}</h2>
    <p>{draft.title} · {t(draft.format)} · {t("round")}</p>
    <p>{t("legacyHint")}</p>
    <p>{table.seats.map((p) => p.localNickname).join(" · ")}</p>
    <div className="ref-actions"><button type="button" onClick={onClose}>{t("back")}</button>
      <Link href="/admin/referee">{t("legacy")}</Link></div>
  </div>;
}
