"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  append, checksum, createCurrentDraft, derive, effectiveEvents, exportProtocol,
  importProtocol, roleErrors, suggestedResult, validateDraft, type Command, type Draft,
} from "@/lib/referee/engine";
import type { Locale } from "@/lib/i18n/messages";
import { refereeText } from "@/lib/i18n/referee";
import type { CloudProtocol, RefereeGame, RefereePlayer } from "@/lib/referee/cloud";
import { CloudPanel } from "./cloud-panel";
import { seatPosition } from "@/lib/referee/table-layout";

type Format = Draft["format"];
type ArchiveItem = { draftId: string; title: string; format: Format; updatedAt: string };
const INDEX_KEY = "mafia-league-referee-index-v1";
const legacyProtocolKey = (id: string) => `mafia-league-referee-v1:${id}`;
const journalLabels: Record<Command["type"], string> = {
  seat_assigned: "Рассадка", role_recorded: "Запись роли", role_confirmed: "Уточнение роли",
  seat_name_corrected: "Уточнение ника", phase_started: "Переход фазы", speech_started: "Речь",
  nomination_accepted: "Выставление", vote_started: "Начало голосования", votes_counted: "Запись голосов",
  vote_stage_closed: "Закрытие стадии", tie_defense: "Защита кандидата", joint_exit_yes_vote: "Совместный выход",
  day_result: "Дневной итог", ordinary_foul: "Фол", technical_warning_manual: "Техническое предупреждение",
  removed: "Удаление", shot_observation: "Отстрел", role_check: "Ночная проверка", night_result: "Ночной итог",
  best_move: "Лучший ход", episode_disputed: "Спорный эпизод", game_finished: "Завершение партии",
  observation_undone: "Отмена действия", observation_redone: "Повтор действия",
};
const sideName: Record<string, string> = {
  civilian: "Мирный", sheriff: "Шериф", mafia: "Мафия", don: "Дон",
};

function messageOf(error: unknown) {
  return error instanceof Error && error.name !== "ZodError" ? error.message : "Не удалось выполнить действие";
}

function prettyTime(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

const button = "min-h-11 rounded-control border border-border bg-surface px-4 py-2 text-sm font-medium hover:border-accent-text disabled:cursor-not-allowed disabled:opacity-40";
const accent = "min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40";
const field = "min-h-11 w-full rounded-control border border-border bg-canvas px-3 py-2 text-text focus:border-accent-text";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4 sm:p-5">
      <h3 className="mb-4 text-lg font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function RefereeWorkbench({ owner, locale, players, games, cloudItems, cloudAvailable }: {
  owner: string; locale: Locale; players: RefereePlayer[]; games: RefereeGame[];
  cloudItems: CloudProtocol[]; cloudAvailable: boolean;
}) {
  const t = (label: string) => refereeText(locale, label);
  const indexKey = `${INDEX_KEY}:${owner}`;
  const keyPrefix = `mafia-league-referee-v2:${owner}:`;
  const [cloud, setCloud] = useState(cloudItems);
  const [fingerprint, setFingerprint] = useState<{ draft: Draft; value: string } | null>(null);
  const [legacy, setLegacy] = useState<ArchiveItem[]>([]);
  const [deviceConflict, setDeviceConflict] = useState(false);
  const lastLocal = useRef<{ id: string; raw: string | null } | null>(null);
  const currentDraft = useRef<Draft | null>(null);
  const [hostId, setHostId] = useState("");
  const [timerLabel, setTimerLabel] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [newFormat, setNewFormat] = useState<Format>("classic10");
  const [newTitle, setNewTitle] = useState("");
  const [newHost, setNewHost] = useState("");
  const [selected, setSelected] = useState(1);
  const [showRoles, setShowRoles] = useState(false);
  const [covered, setCovered] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [timerSeconds, setTimerSeconds] = useState(60);
  const [timerRunning, setTimerRunning] = useState(false);
  const privacyDialog = useRef<HTMLDialogElement>(null);
  const deadlineRef = useRef<number | null>(null);
  const [targetSeat, setTargetSeat] = useState(1);
  const [checkKind, setCheckKind] = useState<"don" | "sheriff">("don");
  const [checkTarget, setCheckTarget] = useState("0");
  const [checkResult, setCheckResult] = useState("unknown");
  const [jointInput, setJointInput] = useState({ key: "", yes: 0 });
  const [reason, setReason] = useState("");
  const [finishOutcome, setFinishOutcome] = useState<"normal" | "technical" | "draw" | "cancelled">("normal");
  const [finishWinner, setFinishWinner] = useState<"red" | "black">("red");
  const [finishBasis, setFinishBasis] = useState("");
  const [resultConfirmed, setResultConfirmed] = useState(true);
  const [bestTrio, setBestTrio] = useState("");
  const [confirmGaps, setConfirmGaps] = useState(false);

  const adopt = useCallback((next: Draft | null) => {
    currentDraft.current = next;
    setDraft(next);
  }, []);

  const replaceDraft = useCallback((next: Draft, previous: string | null) => {
    lastLocal.current = { id: next.draftId, raw: previous };
    adopt(next);
    setDeviceConflict(false);
  }, [adopt]);

  // Device data is partitioned by admin account. Previous versions require explicit recovery.
  useEffect(() => {
    const task = window.setTimeout(() => { try {
      const raw = localStorage.getItem(indexKey);
      const list = raw ? (JSON.parse(raw) as ArchiveItem[]) : [];
      if (!Array.isArray(list)) throw new Error("Повреждён список локальных протоколов");
      setArchive(list);
      const previous = localStorage.getItem(INDEX_KEY);
      if (previous) {
        const candidates: unknown = JSON.parse(previous);
        if (Array.isArray(candidates)) setLegacy(candidates.filter((entry) => entry && typeof entry.draftId === "string"));
      }
      const latest = list[0];
      if (latest) {
        const saved = localStorage.getItem(keyPrefix + latest.draftId);
        if (saved) {
          const parsed = validateDraft(JSON.parse(saved));
          replaceDraft(parsed, saved);
        }
      }
    } catch {
      setError("Локальное восстановление не удалось. Импортируйте сохранённый JSON.");
    } finally {
      setLoaded(true);
    } }, 0);
    return () => window.clearTimeout(task);
  }, [indexKey, keyPrefix, replaceDraft]);

  useEffect(() => {
    if (!loaded || !draft) return;
    try {
      const entry: ArchiveItem = { draftId: draft.draftId, title: draft.title, format: draft.format, updatedAt: new Date().toISOString() };
      const stored = localStorage.getItem(indexKey);
      const all = stored ? JSON.parse(stored) as ArchiveItem[] : [];
      const updated = [entry, ...all.filter((x) => x.draftId !== draft.draftId)];
      const key = keyPrefix + draft.draftId;
      const previous = lastLocal.current;
      const storedDraft = localStorage.getItem(key);
      const raw = JSON.stringify(draft);
      if (storedDraft !== raw && (previous?.id !== draft.draftId || previous.raw !== storedDraft)) {
        const conflictTimer = window.setTimeout(() => setDeviceConflict(true), 0);
        return () => window.clearTimeout(conflictTimer);
      }
      localStorage.setItem(key, raw);
      lastLocal.current = { id: draft.draftId, raw };
      localStorage.setItem(indexKey, JSON.stringify(updated));
      const archiveTimer = window.setTimeout(() => setArchive(updated), 0);
      return () => window.clearTimeout(archiveTimer);
    } catch (err) {
      window.setTimeout(() => setError(`${refereeText(locale, "Не удалось сохранить протокол на устройстве")}: ${refereeText(locale, messageOf(err))}. ${refereeText(locale, "Экспортируйте JSON сейчас.")}`), 0);
    }
  }, [draft, indexKey, keyPrefix, loaded, locale]);

  useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil(((deadlineRef.current ?? Date.now()) - Date.now()) / 1000));
      setTimerSeconds(remaining);
      if (!remaining) { deadlineRef.current = null; setTimerRunning(false); }
    }, 150);
    return () => window.clearInterval(id);
  }, [timerRunning]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCovered((value) => !value);
        setShowRoles(false);
      }
    };
    const onHide = () => {
      if (!document.hidden) return;
      setCovered(true);
      setShowRoles(false);
      pauseTimer();
    };
    const onStorage = (event: StorageEvent) => {
      const local = lastLocal.current;
      if (local && event.key === keyPrefix + local.id && event.newValue !== local.raw) setDeviceConflict(true);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [keyPrefix]);

  useEffect(() => {
    if (!draft) return;
    let active = true;
    void checksum(draft).then((value) => {
      if (active) setFingerprint({ draft, value });
    }).catch(() => { /* Cloud writes retry validation on the server. */ });
    return () => { active = false; };
  }, [draft]);

  useEffect(() => {
    if (covered) privacyDialog.current?.showModal();
    else privacyDialog.current?.close();
  }, [covered]);

  const table = draft ? derive(draft) : null;
  const cloudRecord = cloud.find((record) => record.id === draft?.draftId);
  const approved = !!cloudRecord?.approved_game_id;
  const synced = fingerprint?.draft === draft && fingerprint?.value === cloudRecord?.checksum;
  const readOnly = approved || deviceConflict;
  const selectedSeat = table?.seats.find((x) => x.number === selected);
  const undoState = draft ? effectiveEvents(draft) : null;
  const readyRoles = table ? roleErrors(table.seats).length === 0 : false;
  const shotRequired = !!table && table.phase === "night" && table.round > (table.short9v11 ? 1 : 0);
  const phaseName = table?.phase === "setup" ? t("Подготовка") : table?.phase === "night" ? `${t("Ночь")} N${table.round}` : `${t("День")} D${table?.round}`;
  const effectiveTarget = table?.seats.some((s) => s.number === targetSeat && s.alive)
    ? targetSeat : (table?.seats.find((s) => s.alive)?.number ?? 1);

  function resetControls() {
    pauseTimer();
    setTimerLabel("");
    setTimerSeconds(60);
    setSelected(1);
    setShowRoles(false);
    setCheckTarget("0");
    setCheckResult("unknown");
    setReason("");
    setFinishBasis("");
    setResultConfirmed(true);
    setConfirmGaps(false);
    setBestTrio("");
  }

  function rememberCloud(meta: CloudProtocol) {
    setCloud((items) => [meta, ...items.filter((item) => item.id !== meta.id)]);
  }

  function run(command: Command) {
    return runBatch([command]);
  }

  function runBatch(commands: Command[]) {
    const starting = currentDraft.current;
    if (!starting || readOnly || !commands.length) return false;
    try {
      let updated = starting;
      for (const command of commands) updated = append(updated, command);
      adopt(updated);
      setError("");
      const next = derive(updated);
      setNotice(next.message || "");
      const last = commands.at(-1);
      if (last?.type === "speech_started") {
        const duration = next.seats[last.seat - 1].speechSeconds;
        startTimer(duration || 10, duration ? "Речь" : "Время на выставление");
      } else if (last?.type === "phase_started" || last?.type === "observation_undone" ||
          last?.type === "observation_redone" || last?.type === "game_finished") {
        pauseTimer();
        setTimerLabel("");
      }
      return true;
    } catch (err) {
      setError(messageOf(err));
      return false;
    }
  }

  function createGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hostId && !newHost.trim()) { setError("Укажите отдельного ведущего"); return; }
    try {
      const host = players.find((player) => player.id === hostId);
      const next = createCurrentDraft(newFormat, newTitle.trim() || t("Клубная партия"),
        host ? { localNickname: host.name, optionalPublicPlayerId: host.id } : { localNickname: newHost.trim() });
      if (locale === "uk") next.seats.forEach((seat) => { seat.localNickname = `Гравець ${seat.number}`; });
      replaceDraft(next, null);
      resetControls();
      setCovered(false);
      setShowRoles(false);
      setError("");
      setNotice("Создан новый локальный протокол. Предыдущие протоколы остаются на этом устройстве.");
    } catch (err) { setError(messageOf(err)); }
  }

  function chooseDraft(id: string, fromLegacy = false) {
    try {
      const raw = localStorage.getItem(fromLegacy ? legacyProtocolKey(id) : keyPrefix + id);
      if (!raw) throw new Error("Локальный файл не найден");
      const candidate = validateDraft(JSON.parse(raw));
      if (fromLegacy && localStorage.getItem(keyPrefix + id)) throw new Error("Копия уже есть в локальном архиве");
      replaceDraft(candidate, fromLegacy ? null : raw);
      resetControls();
      setNotice("");
      setError("");
    } catch (err) { setError(messageOf(err)); }
  }

  async function exportFile() {
    if (!draft) return;
    try {
      const json = await exportProtocol(draft);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `mafia-referee-${draft.draftId}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Файл JSON с контрольной суммой подготовлен для сохранения в «Файлы».");
      setError("");
    } catch (err) { setError(messageOf(err)); }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("Файл слишком большой (максимум 2 МБ)");
      const imported = await importProtocol(await file.text());
      const existing = localStorage.getItem(keyPrefix + imported.draftId);
      if (existing && !window.confirm(t("Заменить существующую локальную копию импортированным протоколом?"))) return;
      replaceDraft(imported, existing);
      resetControls();
      setCovered(false);
      setError("");
      setNotice("Контрольная сумма и последовательность событий проверены. Протокол восстановлен.");
    } catch (err) { setError(`${t("Импорт отменён")}: ${t(messageOf(err))}`); }
  }

  function pauseTimer() {
    if (deadlineRef.current !== null) {
      setTimerSeconds(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
      deadlineRef.current = null;
    }
    setTimerRunning(false);
  }

  function startTimer(seconds: number, label = "") {
    setTimerSeconds(seconds);
    setTimerLabel(label);
    deadlineRef.current = Date.now() + seconds * 1000;
    setTimerRunning(seconds > 0);
  }

  const voteBoundary = undoState?.active.findLast((event) => event.command.type === "vote_started" || event.command.type === "tie_defense");
  const voteKey = `${draft?.draftId ?? ""}:${table?.round ?? 0}:${voteBoundary?.id ?? ""}`;
  const [voteInput, setVoteInput] = useState<{ key: string; values: Record<number, number> }>({ key: "", values: {} });
  const voteCounts = voteInput.key === voteKey ? voteInput.values : {};
  const lastWordSeats = table?.phase === "day" && table.vote?.status === "announced" ? table.vote.exits
    : table?.phase === "night" && table.nightResolved && table.shot?.target ? [table.shot.target] : [];

  function resultLabel(result: "red" | "black" | "draw" | null) {
    return result ? t(({ red: "Красные", black: "Чёрные", draw: "Ничья" } as const)[result]) : null;
  }

  const shotActors = table?.seats.filter((seat) => seat.alive && (seat.role === "don" || seat.role === "mafia")) ?? [];
  const seatOptions = table?.seats.filter((s) => s.alive).map((s) => <option key={s.number} value={s.number}>{s.number} · {s.localNickname}</option>);

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">{t("Пульт ведущего")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t("Игровой стол, таймер и протокол. Облачное сохранение и утверждение доступны ниже.")}</p>
        </div>
        {draft && <button type="button" className={button} onClick={() => { setCovered(true); setShowRoles(false); }}>{t("Скрыть экран · Esc")}</button>}
      </div>

      {error && <p role="alert" className="rounded-control border border-error/50 bg-error/10 p-3 text-sm text-error">{t(error)}</p>}
      {notice && <p role="status" className="rounded-control border border-success/30 bg-success/10 p-3 text-sm text-success">{t(notice)}</p>}

      {deviceConflict && <p role="alert" className="text-sm text-warning">{t("Этот протокол изменён в другом окне. Экспортируйте свои правки или откройте локальную копию заново.")} {draft && <button type="button" className={button} onClick={() => chooseDraft(draft.draftId)}>{t("Открыть локальную копию")}</button>}</p>}
      {!loaded ? <p className="text-muted">{t("Восстанавливаем локальный протокол…")}</p> : !draft ? (
        <Section title={t("Новая партия")}>
          <form onSubmit={createGame} className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">{t("Формат")}<select className={field} value={newFormat} onChange={(e) => setNewFormat(e.target.value as Format)}><option value="classic10">{t("Классика 10")}</option><option value="short9">Short9</option></select></label>
            <label className="space-y-1 text-sm">{t("Название")}<input className={field} maxLength={100} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} /></label>
            <label className="space-y-1 text-sm">{t("Ведущий (не сидит за столом)")}
              <select name="host" className={field} value={hostId} onChange={(event) => setHostId(event.target.value)}>
                <option value="">{t("Указать никнейм вручную")}</option>
                {players.map((player) => <option key={player.id} value={player.id}>{player.name} · {player.id.slice(-8)}</option>)}
              </select>
            </label>
            {!hostId && <label className="space-y-1 text-sm">{t("Игровой никнейм ведущего")}<input required className={field} maxLength={64} value={newHost} onChange={(e) => setNewHost(e.target.value)} placeholder={t("Игровой никнейм ведущего")} /></label>}
            <button className={`${accent} sm:col-span-2`} type="submit">{t("Создать протокол")}</button>
          </form>
          <p className="mt-4 text-xs text-muted">{t("Протокол сохраняется на устройстве. Для резервной копии используйте облако или экспорт JSON.")}</p>
        </Section>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface p-3 text-sm">
            <strong className="mr-auto">{draft.title} · {draft.format === "classic10" ? t("Классика 10") : "Short9"}</strong>
            <span className="rounded-full border border-border px-3 py-1">{approved ? t("Утверждена") : draft.status === "completed_unapproved" ? t("Завершена · не утверждена") : phaseName}</span>
            <span className="rounded-full border border-border px-3 py-1">{t("Действий:")} {draft.clientRevision}</span>
            <button type="button" className={button} onClick={() => setShowRoles((value) => !value)} aria-pressed={showRoles}>{showRoles ? t("Скрыть роли") : t("Показать роли")}</button>
          </div>

          <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.45fr)_minmax(350px,1fr)]">
            <div className="space-y-5">
              <section aria-label={t("Круглый игровой стол")} className="rounded-card border border-border bg-surface p-3 sm:p-6">
                <div className="relative mx-auto aspect-square w-full max-w-[600px] [container-type:inline-size]">
                  <div aria-hidden="true" className="absolute inset-[12%] rounded-full border-2 border-[#6c454c] bg-[radial-gradient(circle_at_50%_36%,#31151c,#120e12_74%)] shadow-[inset_0_0_60px_#050505]" />
                  <div aria-hidden="true" className="absolute inset-[34%] flex flex-col items-center justify-center text-center">
                    <span className="font-display text-[clamp(14px,3.5vw,30px)] font-semibold">{phaseName}</span>
                    <span className="mt-1 text-[clamp(10px,1.8vw,16px)] text-muted">{table?.seats.filter((s) => s.alive).length} {t("в игре")}</span>
                  </div>
                  {table?.seats.map((seat) => (
                    <button
                      key={seat.number}
                      type="button"
                      aria-pressed={selected === seat.number}
                      aria-label={`${t("Место")} ${seat.number}, ${seat.localNickname}${seat.alive ? "" : `, ${t("выбыл")}`}`}
                      style={seatPosition(seat.number, draft.format === "classic10" ? 10 : 9)}
                      onClick={() => setSelected(seat.number)}
                      className={`absolute z-10 flex size-[clamp(44px,16cqw,84px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-2 p-1 text-center shadow-lg transition-colors ${selected === seat.number ? "border-accent-text bg-[#61242f]" : "border-border bg-elevated"} ${seat.alive ? "" : "opacity-45"}`}
                    >
                      <span className="text-lg font-bold leading-none">{seat.number}</span>
                      <span className="mt-1 w-full truncate text-[9px] leading-tight sm:text-xs">{seat.localNickname}</span>
                      {showRoles && seat.role && <span className={`text-[9px] ${seat.role === "don" || seat.role === "mafia" ? "text-muted" : "text-error"}`}>{t(sideName[seat.role])}</span>}
                    </button>
                  ))}
                  <div aria-label={`${t("Ведущий")}: ${draft.host?.localNickname ?? t("не указан")}`} className="absolute bottom-[-3%] left-1/2 max-w-[46%] -translate-x-1/2 truncate rounded-full border border-accent/70 bg-canvas px-4 py-1 text-xs font-semibold">{t("Ведущий")} · {draft.host?.localNickname}</div>
                </div>
                <p className="mt-5 text-center text-xs text-muted">{draft.format === "classic10" ? t("Места 1 и 10 рядом с ведущим, 5 и 6 напротив.") : t("Девять мест вокруг стола.")} {t("Нажмите на место для действия.")}</p>
              </section>

              {selectedSeat && <Section title={`${t("Место")} ${selected} · ${selectedSeat.localNickname}`}>
                <div className="mb-4 flex flex-wrap gap-2 text-sm text-muted">
                  <span>{selectedSeat.alive ? t("В игре") : t("Выбыл")}</span>
                  <span>· {t("Фолы")} {selectedSeat.fouls}/4</span>
                  <span>· {t("Технические")} {selectedSeat.technical}/2</span>
                  {showRoles && <span>· {t(selectedSeat.role ? sideName[selectedSeat.role] : "Роль не указана")}</span>}
                </div>
                {table?.phase === "setup" && !readOnly && (
                  <form key={`${draft.draftId}-${selected}-${draft.clientRevision}-${showRoles}`} className="space-y-3" onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    const linked = players.find((player) => player.id === data.get("player"));
                    const name = linked?.name ?? String(data.get("nickname") ?? "").trim();
                    const role = String(data.get("role") ?? "") as "" | "keep" | "civilian" | "sheriff" | "mafia" | "don";
                    const changes: Command[] = [];
                    if (name !== selectedSeat.localNickname || linked?.id !== selectedSeat.optionalPublicPlayerId) {
                      changes.push({ type: "seat_assigned", seat: selected, name, ...(linked ? { playerId: linked.id } : {}) });
                    }
                    if (role !== "keep" && (role || null) !== selectedSeat.role) changes.push({ type: "role_recorded", seat: selected, role: role || null });
                    runBatch(changes);
                  }}>
                    <label className="block space-y-1 text-sm">{t("Игрок из реестра")}
                      <select name="player" className={field} defaultValue={selectedSeat.optionalPublicPlayerId ?? ""}>
                        <option value="">{t("Указать никнейм вручную")}</option>
                        {players.filter((player) => player.id !== draft.host?.optionalPublicPlayerId &&
                          !table.seats.some((seat) => seat.number !== selected && seat.optionalPublicPlayerId === player.id))
                          .map((player) => <option key={player.id} value={player.id}>{player.name} · {player.id.slice(-8)}</option>)}
                      </select>
                    </label>
                    <label className="block space-y-1 text-sm">{t("Игровой никнейм")}<input name="nickname" required maxLength={64} defaultValue={selectedSeat.localNickname} className={field} /></label>
                    <label className="block space-y-1 text-sm">{t("Закрытая роль")}<select name="role" defaultValue={showRoles ? selectedSeat.role ?? "" : "keep"} className={field}><option value="keep">{t("Сохранить текущую роль")}</option><option value="">{t("Не указана")}</option><option value="civilian">{t("Мирный")}</option><option value="sheriff">{t("Шериф")}</option><option value="mafia">{t("Мафия")}</option><option value="don">{t("Дон")}</option></select></label>
                    <button type="submit" className={accent}>{t("Сохранить игрока и роль")}</button>
                  </form>
                )}
                {!readOnly && table?.phase !== "setup" && !table?.result && selectedSeat.alive && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={button} onClick={() => run({ type: "ordinary_foul", seat: selected })}>{t("+ Фол")}</button>
                    <button type="button" className={button} onClick={() => { if (reason.trim()) run({ type: "technical_warning_manual", seat: selected, reason: reason.trim() }); else setError("Укажите причину технического предупреждения"); }}>{t("Техническое")}</button>
                    <button type="button" className={button} onClick={() => { if (!reason.trim()) { setError("Укажите причину удаления"); return; } if (window.confirm(`${t("Удалить место")} ${selected}?`)) run({ type: "removed", seat: selected, reason: reason.trim() }); }}>{t("Удалить")}</button>
                    {table?.phase === "day" && <button type="button" className={accent} onClick={() => run({ type: "speech_started", seat: selected })}>{t("Начать речь")}</button>}
                  </div>
                )}
                {!readOnly && table?.phase !== "setup" && (
                  <details className="mt-3 rounded-control border border-border px-3">
                    <summary className="min-h-11 cursor-pointer py-3 text-sm">{t("Уточнить роль или никнейм")}</summary>
                    <form key={selected} className="space-y-2 pb-3" onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      const note = String(data.get("correction") ?? "").trim();
                      const name = String(data.get("name") ?? "").trim();
                      const role = String(data.get("confirmedRole") ?? "keep") as "" | "keep" | "civilian" | "sheriff" | "don" | "mafia";
                      if (!note) return setError("Укажите основание исправления.");
                      const commands: Command[] = [];
                      if (name && name !== selectedSeat.localNickname) commands.push({ type: "seat_name_corrected", seat: selected, name, reason: note });
                      if (role !== "keep" && (role || null) !== selectedSeat.role) commands.push({ type: "role_confirmed", seat: selected, role: role || null, reason: note });
                      if (runBatch(commands)) event.currentTarget.reset();
                    }}>
                      <label className="block text-sm">{t("Новый никнейм")}<input name="name" maxLength={64} className={field} /></label>
                      <label className="block text-sm">{t("Закрытая роль")}
                        <select name="confirmedRole" defaultValue="keep" className={field}>
                          <option value="keep">{t("Сохранить текущую роль")}</option>
                          <option value="">{t("Не указана")}</option>
                          {Object.entries(sideName).map(([role, name]) => <option key={role} value={role}>{t(name)}</option>)}
                        </select>
                      </label>
                      <label className="block text-sm">{t("Основание исправления")}<input name="correction" required maxLength={500} className={field} /></label>
                      <button type="submit" className={button}>{t("Сохранить уточнение")}</button>
                    </form>
                  </details>
                )}
                {!readOnly && table?.phase !== "setup" && !table?.result && <label className="mt-3 block space-y-1 text-sm">{t("Причина для предупреждения/удаления")}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className={field} placeholder={t("Фактическое основание")} /></label>}
              </Section>}

              <Section title={t("Журнал и восстановление")}>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={button} disabled={readOnly || !undoState?.active.length} onClick={() => { const last = undoState?.active.at(-1); if (last) run({ type: "observation_undone", target: last.id, reason: "Ручная отмена ведущим" }); }}>{t("Отменить")}</button>
                  <button type="button" className={button} disabled={readOnly || !undoState?.redo.length} onClick={() => { const last = undoState?.redo.at(-1); if (last) run({ type: "observation_redone", target: last.id, reason: "Возврат действия ведущим" }); }}>{t("Повторить")}</button>
                  <button type="button" className={accent} onClick={exportFile}>{t("Экспорт JSON")}</button>
                  <label className={`${button} cursor-pointer`}>{t("Импорт JSON")}<input className="sr-only" type="file" accept=".json,application/json" onChange={importFile} /></label>
                </div>
                <ol className="mt-4 max-h-48 space-y-1 overflow-y-auto text-xs text-muted">
                  {draft.events.slice(-12).reverse().map((event) => <li key={event.id}>№{event.sequence} · {event.phase === "setup" ? t("Подготовка") : event.phase} · {t(journalLabels[event.command.type])}</li>)}
                </ol>

              </Section>
            </div>

            <div className="space-y-5">
              <Section title={t("Таймер")}>
                {timerLabel && <p className="text-center text-sm text-muted">{t(timerLabel)}</p>}
                <div aria-live="off" className={`text-center font-mono text-6xl font-bold tabular-nums ${timerSeconds <= 10 ? "text-error" : "text-text"}`}>{prettyTime(timerSeconds)}</div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" className={accent} disabled={timerRunning || timerSeconds === 0} onClick={() => startTimer(timerSeconds, timerLabel)}>{t("Старт")}</button>
                  <button type="button" className={button} disabled={!timerRunning} onClick={pauseTimer}>{t("Пауза")}</button>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">{[20, 30, 60].map((seconds) => <button key={seconds} type="button" className={button} onClick={() => { deadlineRef.current = null; setTimerRunning(false); setTimerSeconds(seconds); setTimerLabel(""); }}>{seconds} {t("сек.")}</button>)}</div>
                {lastWordSeats.map((seat) => <button key={seat} type="button" className={`${button} mt-2 w-full`}
                  onClick={() => startTimer(60, "Последнее слово")}>{t("Последнее слово")} · {seat}</button>)}
                <p className="mt-3 text-xs text-muted">{t("При сворачивании или блокировке устройства таймер ставится на паузу. Проверьте реальное время перед продолжением.")}</p>
              </Section>

              {!readOnly && table?.phase === "setup" && <Section title={t("Начало партии")}>
                <p className="mb-3 text-sm text-muted">{t("Состав ролей:")} {t(readyRoles ? "подтверждён" : "ещё не полный")}. {t("Ведущий")}: {draft.host?.localNickname}.</p>
                <button type="button" className={accent} onClick={() => run({ type: "phase_started", next: "night" })}>{t("Начать первую ночь (N0)")}</button>
              </Section>}

              {!readOnly && table?.phase === "night" && !table.result && <Section title={`${t("Ночные действия")} · N${table.round}`}>
                {shotRequired && !table.shot && <div className="mb-4 space-y-3">
                  <p className="text-sm font-semibold">{t("Отстрел")}</p>
                  <select className={field} value={effectiveTarget} onChange={(e) => setTargetSeat(Number(e.target.value))}>{seatOptions}</select>
                  <div className="flex flex-wrap gap-2">
                    <button className={button} type="button" onClick={() => run({ type: "shot_observation", mode: "target", target: effectiveTarget })}>{t("Цель")} {effectiveTarget}</button>
                    <button className={button} type="button" onClick={() => run({ type: "shot_observation", mode: "miss" })}>{t("Промах")}</button>
                    <button className={button} type="button" onClick={() => run({ type: "shot_observation", mode: "unknown" })}>{t("Неизвестно")}</button>
                  </div>
                  {showRoles && readyRoles && (
                    <details className="rounded-control border border-border px-3">
                      <summary className="min-h-11 cursor-pointer py-3 text-sm">{t("Независимые выстрелы")}</summary>
                      <form className="space-y-2 pb-3" onSubmit={(event) => {
                        event.preventDefault();
                        const data = new FormData(event.currentTarget);
                        const shots = shotActors.map((actor) => ({
                          actor: actor.number, target: Number(data.get(`shot-${actor.number}`)) || null,
                        }));
                        run({ type: "shot_observation", mode: "independent", shots });
                      }}>
                        {shotActors.map((actor) => <label key={actor.number} className="block text-sm">
                          {actor.number} · {actor.localNickname}
                          <select name={`shot-${actor.number}`} required defaultValue="" className={field}>
                            <option value="">{t("Выберите цель")}</option>
                            <option value="0">{t("Выстрела не было")}</option>
                            {seatOptions}
                          </select>
                        </label>)}
                        <button type="submit" className={button}>{t("Записать выстрелы")}</button>
                      </form>
                    </details>
                  )}
                </div>}
                {(table.round > 0 || draft.format === "short9") && !table.nightResolved && <div className="mb-4 space-y-3">
                  <p className="text-sm font-semibold">{t("Проверки: Дон → Шериф")}</p>
                  <select aria-label={t("Кто проверяет")} className={field} value={checkKind} onChange={(e) => { setCheckKind(e.target.value as "don" | "sheriff"); setCheckResult("unknown"); }}><option value="don">{t("Дон")}</option><option value="sheriff">{t("Шериф")}</option></select>
                  <select aria-label={t("Цель проверки")} className={field} value={checkTarget} onChange={(e) => setCheckTarget(e.target.value)}><option value="0">{t("Цель отсутствует / не установлена")}</option>{seatOptions}</select>
                  <select aria-label={t("Результат проверки")} className={field} value={checkResult} onChange={(e) => setCheckResult(e.target.value)}>
                    <option value="unknown">{t("Неизвестно")}</option><option value="absent">{t("Нет проверки")}</option>
                    {checkKind === "don" ? <><option value="sheriff">{t("Шериф")}</option><option value="not_sheriff">{t("Не шериф")}</option></> : <><option value="red">{t("Красный")}</option><option value="black">{t("Чёрный")}</option></>}
                  </select>
                  <button type="button" className={button} onClick={() => startTimer(20, "Ночная проверка")}>{t("Таймер проверки")} · 20 {t("сек.")}</button>
                  <button type="button" className={button} onClick={() => run({ type: "role_check", kind: checkKind, target: checkTarget === "0" ? null : Number(checkTarget), result: checkResult as "unknown" | "absent" | "red" | "black" | "sheriff" | "not_sheriff" })}>{t("Зафиксировать проверку")}</button>
                  <p className="text-xs text-muted">{t("Отмечено проверок:")} {table.checks.length}/2.</p>
                </div>}
                {!table.nightResolved ? <div className="space-y-3">
                  {(table.round > 0 || draft.format === "short9") && table.checks.length !== 2 && <label className="flex items-start gap-2 text-sm text-warning"><input className="mt-1" type="checkbox" checked={confirmGaps} onChange={(e) => setConfirmGaps(e.target.checked)} />{t("Я подтверждаю, что недостающие проверки действительно не наблюдались. Не выдумывать результат.")}</label>}
                  <button type="button" className={accent} disabled={(table.round > 0 || draft.format === "short9") && table.checks.length !== 2 && !confirmGaps} onClick={() => { if (run({ type: "night_result", unobservedConfirmed: confirmGaps })) setConfirmGaps(false); }}>{t("Завершить ночь")}</button>
                </div> : (
                  <div className="space-y-3">
                    {table.bestEligible !== null && !table.bestTrio && <div className="space-y-2">
                      <p className="text-sm">{t("Лучший ход места")} {table.bestEligible}, {t("три номера через запятую")}</p>
                      <input className={field} value={bestTrio} onChange={(e) => setBestTrio(e.target.value)} placeholder="1, 2, 3" />
                      <button type="button" className={button} onClick={() => run({ type: "best_move", trio: bestTrio.split(",").map(Number) as [number, number, number] })}>{t("Сохранить лучший ход")}</button>
                    </div>}
                    <button type="button" className={accent} onClick={() => run({ type: "phase_started", next: "day" })}>{t("Перейти к дню")}</button>
                  </div>
                )}
              </Section>}

              {!readOnly && table?.phase === "day" && !table.result && <Section title={`${t("Дневные действия")} · D${table.round}`}>
                {!table.vote && <div className="space-y-3">
                  <p className="text-sm text-muted">{t("Выбранное место")} {selected} {t("выставляет кандидата")}</p>
                  <select className={field} value={effectiveTarget} onChange={(e) => setTargetSeat(Number(e.target.value))}>{seatOptions}</select>
                  <button type="button" className={button} onClick={() => run({ type: "nomination_accepted", actor: selected, target: effectiveTarget })}>{t("Выставить")} {effectiveTarget}</button>
                  <p className="text-xs text-muted">{t("Кандидаты:")} {table.nominations.map((x) => x.target).join(", ") || t("нет")}</p>
                  <button type="button" className={accent} onClick={() => run({ type: "vote_started" })}>{t("Начать голосование")}</button>
                </div>}
                {table.vote?.status === "open" && <div className="space-y-3">
                  <p className="text-sm">{t("Стадия")} {table.vote.stage} · {t("голоса по кандидатам")}</p>
                  {table.vote.candidates.map((num) => <label key={`${table.vote?.stage}-${num}`} className="flex items-center justify-between gap-4 text-sm">{t("Место")} {num}<input type="number" min={0} max={table.seats.filter((x) => x.alive).length} className={`${field} max-w-24`} value={voteCounts[num] ?? table.vote?.counts[table.vote.candidates.indexOf(num)] ?? 0} onChange={(e) => setVoteInput({ key: voteKey, values: { ...voteCounts, [num]: Number(e.target.value) } })} /></label>)}
                  <button type="button" className={button} onClick={() => { if (run({ type: "votes_counted", counts: table.vote!.candidates.map((num, index) => voteCounts[num] ?? table.vote!.counts[index]), source: "referee_count_only" })) setVoteInput({ key: "", values: {} }); }}>{t("Записать голоса")}</button>
                  <button type="button" className={accent} onClick={() => run({ type: "vote_stage_closed" })}>{t("Завершить стадию голосования")}</button>
                </div>}
                {table.vote?.status === "defense" && <div className="space-y-2"><p className="text-sm">{t("Защита кандидатов:")} {table.vote.candidates.join(", ")}</p>{table.vote.candidates.filter((num) => !table.vote?.defended.includes(num)).map((num) => <button key={num} type="button" className={button} onClick={() => { if (run({ type: "tie_defense", seat: num })) { startTimer(30, "Защита кандидата"); } }}>{t("Защита места")} {num} · 30 {t("сек.")}</button>)}</div>}
                {table.vote?.status === "joint" && <div className="space-y-3"><p className="text-sm">{t("Голосование за совместный выход")}</p><input type="number" min={0} max={table.seats.filter((x) => x.alive).length} className={field} value={jointInput.key === voteKey ? jointInput.yes : 0} onChange={(e) => setJointInput({ key: voteKey, yes: Number(e.target.value) })} /><button type="button" className={button} onClick={() => run({ type: "joint_exit_yes_vote", yes: jointInput.key === voteKey ? jointInput.yes : 0 })}>{t("Записать голоса «за»")}</button></div>}
                {(table.vote?.status === "ready" || table.vote?.status === "cancelled") && <button type="button" className={accent} onClick={() => run({ type: "day_result" })}>{t("Объявить дневной итог")}</button>}
                {(table.vote?.status === "announced" || table.vote?.status === "cancelled") && <button type="button" className={`${button} mt-3`} onClick={() => run({ type: "phase_started", next: "night" })}>{t("Следующая ночь")}</button>}
              </Section>}

              {!readOnly && !table?.result && table?.phase !== "setup" && <Section title={t("Завершение партии")}>
                <form className="space-y-3" onSubmit={(e) => {
                  e.preventDefault();
                  run({ type: "game_finished", outcome: finishOutcome, winner: finishOutcome === "draw" || finishOutcome === "cancelled" ? null : finishWinner, basis: finishBasis, confidence: resultConfirmed ? "observed" : "uncertain" });
                }}>
                  <p className="text-xs text-muted">{t("Подсказка движка:")} {table ? (resultLabel(suggestedResult(table)) ?? t("исход не установлен")) : t("нет партии")}. {t("Итог всегда подтверждает ведущий.")}</p>
                  <label className="block space-y-1 text-sm">{t("Тип результата")}<select className={field} value={finishOutcome} onChange={(e) => setFinishOutcome(e.target.value as typeof finishOutcome)}><option value="normal">{t("Обычный")}</option><option value="technical">{t("Технический")}</option><option value="draw">{t("Ничья")}</option><option value="cancelled">{t("Без результата")}</option></select></label>
                  {finishOutcome !== "draw" && finishOutcome !== "cancelled" && <label className="block space-y-1 text-sm">{t("Победитель")}<select className={field} value={finishWinner} onChange={(e) => setFinishWinner(e.target.value as "red" | "black")}><option value="red">{t("Красные")}</option><option value="black">{t("Чёрные")}</option></select></label>}
                  <label className="block space-y-1 text-sm">{t("Основание (не менее 8 символов)")}<textarea className={`${field} min-h-24`} value={finishBasis} onChange={(e) => setFinishBasis(e.target.value)} maxLength={1000} placeholder={t("Что фактически произошло?")} /></label>
                  <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={resultConfirmed} onChange={(event) => setResultConfirmed(event.target.checked)} />{t("Исход подтверждён наблюдением")}</label>
                  <button type="submit" className={accent}>{t("Завершить локальный протокол")}</button>
                </form>
              </Section>}

              {table?.result && <Section title={t(approved ? "Утверждена" : "Игра завершена · не утверждена")}>
                <p className="text-sm">{t(({ normal: "Обычный", technical: "Технический", draw: "Ничья", cancelled: "Без результата" } as const)[table.result.outcome])} · {resultLabel(table.result.winner) ?? t("без победителя")}</p>
                <p className="mt-2 text-sm text-muted">{table.result.basis}</p>
                {table.result.confidence === "uncertain" && <p className="mt-2 text-sm text-warning">{t("Исход не подтверждён. Такой протокол остаётся в архиве.")}</p>}

              </Section>}

              <Section title={t("Другие локальные протоколы")}>
                <div className="space-y-2">
                  {[...new Map([...archive, { draftId: draft.draftId, title: draft.title, format: draft.format, updatedAt: "" }].map((x) => [x.draftId, x])).values()].filter((x) => x.draftId !== draft.draftId).map((item) => (
                    <button key={item.draftId} type="button" className={`${button} w-full text-left`} onClick={() => chooseDraft(item.draftId)}>{item.title} · {item.format}</button>
                  ))}
                  <button type="button" className={`${button} w-full`} onClick={() => { adopt(null); resetControls(); setArchive((items) => [
                    { draftId: draft.draftId, title: draft.title, format: draft.format, updatedAt: new Date().toISOString() },
                    ...items.filter((x) => x.draftId !== draft.draftId),
                  ]); }}>{t("Новая партия (текущая останется в архиве)")}</button>
                </div>
              </Section>
            </div>
          </div>
        </>
      )}

      {!draft && loaded && archive.length > 0 && <Section title={t("Сохранённые локальные партии")}><div className="grid gap-2 sm:grid-cols-2">{archive.map((item) => <button key={item.draftId} className={`${button} text-left`} type="button" onClick={() => chooseDraft(item.draftId)}>{item.title} · {item.format}</button>)}</div><div className="mt-4"><label className={`${button} inline-flex cursor-pointer`}>{t("Импорт JSON")}<input type="file" accept=".json,application/json" className="sr-only" onChange={importFile} /></label></div></Section>}
      {!draft && loaded && archive.length === 0 && <div className="text-sm text-muted"><label className={`${button} inline-flex cursor-pointer`}>{t("Восстановить JSON")}<input type="file" accept=".json,application/json" className="sr-only" onChange={importFile} /></label></div>}

      {loaded && <CloudPanel key={draft?.draftId ?? "archive"} locale={locale} available={cloudAvailable} draft={draft} table={table}
        items={cloud} synced={synced} deviceConflict={deviceConflict} games={games} players={players} onSaved={rememberCloud}
        onRestored={(meta, snapshot) => {
          const existing = localStorage.getItem(keyPrefix + snapshot.draftId);
          if (existing && existing !== JSON.stringify(snapshot) && !window.confirm(t("Заменить локальную копию облачной?"))) return false;
          replaceDraft(snapshot, existing);
          rememberCloud(meta);
          resetControls();
          setError("");
          setNotice("");
          return true;
        }}
        onApproved={(id, game) => setCloud((items) => items.map((item) => item.id === id ? { ...item, approved_game_id: game } : item))} />}
      {loaded && legacy.some((item) => !archive.some((copy) => copy.draftId === item.draftId)) && (
        <details className="rounded-card border border-border bg-surface p-4">
          <summary className="cursor-pointer">{t("Протоколы из предыдущей версии пульта")}</summary>
          <p className="my-2 text-sm text-muted">{t("Открывайте старый протокол только если он принадлежит вам.")}</p>
          <div className="flex flex-wrap gap-2">{legacy.filter((item) => !archive.some((copy) => copy.draftId === item.draftId)).map((item) => (
            <button key={item.draftId} type="button" className={button} onClick={() => chooseDraft(item.draftId, true)}>{item.title} · {item.format}</button>
          ))}</div>
        </details>
      )}
      {timerRunning && !covered && <div className="fixed inset-x-2 bottom-2 z-40 mx-auto flex max-w-sm items-center justify-between rounded-control border border-border bg-canvas px-3 shadow-lg md:hidden">
        <span className="text-sm">{t(timerLabel || "Таймер")} · <strong className="font-mono">{prettyTime(timerSeconds)}</strong></span>
        <button type="button" className="min-h-11 px-2 text-sm" onClick={pauseTimer}>{t("Пауза")}</button>
      </div>}
      <dialog ref={privacyDialog} className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-[#07090b] p-8 text-text backdrop:bg-[#07090b]"
        aria-label={t("Экран скрыт")} onCancel={(event) => { event.preventDefault(); setCovered(false); }}>
        <div className="flex min-h-full flex-col items-center justify-center gap-5 text-center">
          <span className="font-display text-4xl font-semibold tracking-widest">MAFIA LEAGUE</span>
          <p className="max-w-md text-muted">{t("Приватные данные ведущего скрыты. Для продолжения нажмите кнопку или Esc.")}</p>
          <button type="button" className={accent} onClick={() => setCovered(false)}>{t("Вернуться к пульту")}</button>
        </div>
      </dialog>
    </div>
  );
}
