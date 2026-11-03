"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  append, createCurrentDraft, derive, effectiveEvents, exportProtocol,
  importProtocol, roleErrors, suggestedResult, validateDraft, type Command, type Draft,
} from "@/lib/referee/engine";
import { seatPosition } from "@/lib/referee/table-layout";

type Format = Draft["format"];
type ArchiveItem = { draftId: string; title: string; format: Format; updatedAt: string };
const INDEX_KEY = "mafia-league-referee-index-v1";
const protocolKey = (id: string) => `mafia-league-referee-v1:${id}`;
const sideName: Record<string, string> = {
  civilian: "Мирный", sheriff: "Шериф", mafia: "Мафия", don: "Дон",
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось выполнить действие";
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

export function RefereeWorkbench() {
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [newFormat, setNewFormat] = useState<Format>("classic10");
  const [newTitle, setNewTitle] = useState("Клубная партия");
  const [newHost, setNewHost] = useState("");
  const [selected, setSelected] = useState(1);
  const [showRoles, setShowRoles] = useState(false);
  const [covered, setCovered] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [timerSeconds, setTimerSeconds] = useState(60);
  const [timerRunning, setTimerRunning] = useState(false);
  const deadlineRef = useRef<number | null>(null);
  const [targetSeat, setTargetSeat] = useState(1);
  const [checkKind, setCheckKind] = useState<"don" | "sheriff">("don");
  const [checkTarget, setCheckTarget] = useState("0");
  const [checkResult, setCheckResult] = useState("unknown");
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [jointYes, setJointYes] = useState(0);
  const [reason, setReason] = useState("");
  const [finishOutcome, setFinishOutcome] = useState<"normal" | "technical" | "draw" | "cancelled">("normal");
  const [finishWinner, setFinishWinner] = useState<"red" | "black">("red");
  const [finishBasis, setFinishBasis] = useState("");
  const [bestTrio, setBestTrio] = useState("");
  const [confirmGaps, setConfirmGaps] = useState(false);

  // The referee protocol remains on this browser/device. No automatic Core writes.
  useEffect(() => {
    const task = window.setTimeout(() => { try {
      const raw = localStorage.getItem(INDEX_KEY);
      const list = raw ? (JSON.parse(raw) as ArchiveItem[]) : [];
      if (!Array.isArray(list)) throw new Error("Повреждён список локальных протоколов");
      setArchive(list);
      const latest = list[0];
      if (latest) {
        const saved = localStorage.getItem(protocolKey(latest.draftId));
        if (saved) {
          const parsed = validateDraft(JSON.parse(saved));
          setDraft(parsed);
        }
      }
    } catch (err) {
      setError(`Локальное восстановление не удалось: ${messageOf(err)}. Импортируйте сохранённый JSON.`);
    } finally {
      setLoaded(true);
    } }, 0);
    return () => window.clearTimeout(task);
  }, []);

  useEffect(() => {
    if (!loaded || !draft) return;
    try {
      const entry: ArchiveItem = { draftId: draft.draftId, title: draft.title, format: draft.format, updatedAt: new Date().toISOString() };
      const stored = localStorage.getItem(INDEX_KEY);
      const all = stored ? JSON.parse(stored) as ArchiveItem[] : [];
      const updated = [entry, ...all.filter((x) => x.draftId !== draft.draftId)];
      localStorage.setItem(protocolKey(draft.draftId), JSON.stringify(draft));
      localStorage.setItem(INDEX_KEY, JSON.stringify(updated));
      window.setTimeout(() => setArchive(updated), 0);
    } catch (err) {
      window.setTimeout(() => setError(`Не удалось сохранить протокол на устройстве: ${messageOf(err)}. Экспортируйте JSON сейчас.`), 0);
    }
  }, [draft, loaded]);

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
        setCovered((value) => !value);
        setShowRoles(false);
      }
    };
    const onHide = () => {
      if (!document.hidden) return;
      setCovered(true);
      setShowRoles(false);
      if (deadlineRef.current !== null) {
        setTimerSeconds(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
        deadlineRef.current = null;
        setTimerRunning(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  const table = draft ? derive(draft) : null;
  const selectedSeat = table?.seats.find((x) => x.number === selected);
  const undoState = draft ? effectiveEvents(draft) : null;
  const readyRoles = table ? roleErrors(table.seats).length === 0 : false;
  const shotRequired = !!table && table.phase === "night" && table.round > (table.short9v11 ? 1 : 0);
  const phaseName = table?.phase === "setup" ? "Подготовка" : table?.phase === "night" ? `Ночь N${table.round}` : `День D${table?.round}`;
  const effectiveTarget = table?.seats.some((s) => s.number === targetSeat && s.alive)
    ? targetSeat : (table?.seats.find((s) => s.alive)?.number ?? 1);

  function run(command: Command) {
    if (!draft) return false;
    try {
      const updated = append(draft, command);
      setDraft(updated);
      setError("");
      setNotice(`Действие №${updated.clientRevision} сохранено локально`);
      if (command.type === "speech_started") {
        setTimerSeconds(derive(updated).seats[command.seat - 1].speechSeconds);
        deadlineRef.current = null;
        setTimerRunning(false);
      }
      return true;
    } catch (err) {
      setError(messageOf(err));
      return false;
    }
  }

  function runBatch(commands: Command[]) {
    if (!draft || commands.length === 0) return;
    try {
      let updated = draft;
      for (const command of commands) updated = append(updated, command);
      setDraft(updated);
      setError("");
      setNotice(`Действия до №${updated.clientRevision} сохранены локально`);
    } catch (err) { setError(messageOf(err)); }
  }

  function createGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newHost.trim()) { setError("Укажите отдельного ведущего"); return; }
    try {
      const next = createCurrentDraft(newFormat, newTitle.trim() || "Клубная партия", { localNickname: newHost.trim() });
      setDraft(next);
      setSelected(1);
      setCovered(false);
      setShowRoles(false);
      setError("");
      setNotice("Создан новый локальный протокол. Предыдущие протоколы остаются на этом устройстве.");
    } catch (err) { setError(messageOf(err)); }
  }

  function chooseDraft(id: string) {
    try {
      const raw = localStorage.getItem(protocolKey(id));
      if (!raw) throw new Error("Локальный файл не найден");
      const candidate = JSON.parse(raw) as Draft;
      validateDraft(candidate);
      setDraft(candidate);
      setSelected(1);
      setShowRoles(false);
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
      setDraft(imported);
      setSelected(1);
      setShowRoles(false);
      setCovered(false);
      setError("");
      setNotice("Контрольная сумма и последовательность событий проверены. Протокол восстановлен.");
    } catch (err) { setError(`Импорт отменён: ${messageOf(err)}`); }
  }

  function pauseTimer() {
    if (deadlineRef.current !== null) {
      setTimerSeconds(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
      deadlineRef.current = null;
    }
    setTimerRunning(false);
  }

  const seatOptions = table?.seats.filter((s) => s.alive).map((s) => <option key={s.number} value={s.number}>{s.number} · {s.localNickname}</option>);

  return (
    <div className="space-y-5 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent-text">Mafia League · Referee</p>
          <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Пульт ведущего</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">Физический стол, таймер, этапы игры и журнал действий. Только локальный черновик: данные клуба автоматически не изменяются.</p>
        </div>
        {draft && <button type="button" className={button} onClick={() => { setCovered(true); setShowRoles(false); }}>Скрыть экран · Esc</button>}
      </div>

      {error && <p role="alert" className="rounded-control border border-error/50 bg-error/10 p-3 text-sm text-error">{error}</p>}
      {notice && <p role="status" className="rounded-control border border-success/30 bg-success/10 p-3 text-sm text-success">{notice}</p>}

      {!loaded ? <p className="text-muted">Восстанавливаем локальный протокол…</p> : !draft ? (
        <Section title="Новая партия">
          <form onSubmit={createGame} className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">Формат<select className={field} value={newFormat} onChange={(e) => setNewFormat(e.target.value as Format)}><option value="classic10">Классика 10</option><option value="short9">Short9</option></select></label>
            <label className="space-y-1 text-sm">Название<input className={field} maxLength={100} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} /></label>
            <label className="space-y-1 text-sm sm:col-span-2">Ведущий (не сидит за столом)<input required className={field} maxLength={64} value={newHost} onChange={(e) => setNewHost(e.target.value)} placeholder="Игровой никнейм ведущего" /></label>
            <button className={`${accent} sm:col-span-2`} type="submit">Создать протокол</button>
          </form>
          <p className="mt-4 text-xs text-muted">Роли и события сохраняются только на этом устройстве. После игры обязательно экспортируйте JSON с контрольной суммой.</p>
        </Section>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface p-3 text-sm">
            <strong className="mr-auto">{draft.title} · {draft.format === "classic10" ? "Классика 10" : "Short9"}</strong>
            <span className="rounded-full border border-border px-3 py-1">{draft.status === "completed_unapproved" ? "Завершена · не утверждена" : phaseName}</span>
            <span className="rounded-full border border-border px-3 py-1">Действий: {draft.clientRevision}</span>
            <button type="button" className={button} onClick={() => setShowRoles((value) => !value)} aria-pressed={showRoles}>{showRoles ? "Скрыть роли" : "Показать роли"}</button>
          </div>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(350px,1fr)]">
            <div className="space-y-5">
              <section aria-label="Круглый игровой стол" className="rounded-card border border-border bg-surface p-3 sm:p-6">
                <div className="relative mx-auto aspect-square w-full max-w-[600px]">
                  <div aria-hidden="true" className="absolute inset-[12%] rounded-full border-2 border-[#6c454c] bg-[radial-gradient(circle_at_50%_36%,#31151c,#120e12_74%)] shadow-[inset_0_0_60px_#050505]" />
                  <div aria-hidden="true" className="absolute inset-[34%] flex flex-col items-center justify-center text-center">
                    <span className="font-display text-[clamp(14px,3.5vw,30px)] font-semibold">{phaseName}</span>
                    <span className="mt-1 text-[clamp(10px,1.8vw,16px)] text-muted">{table?.seats.filter((s) => s.alive).length} в игре</span>
                  </div>
                  {table?.seats.map((seat) => (
                    <button
                      key={seat.number}
                      type="button"
                      aria-pressed={selected === seat.number}
                      aria-label={`Место ${seat.number}, ${seat.localNickname}${seat.alive ? "" : ", выбыл"}`}
                      style={seatPosition(seat.number, draft.format === "classic10" ? 10 : 9)}
                      onClick={() => setSelected(seat.number)}
                      className={`absolute z-10 flex h-[clamp(54px,12vw,84px)] w-[clamp(54px,12vw,84px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-2 p-1 text-center shadow-lg transition-colors ${selected === seat.number ? "border-accent-text bg-[#61242f]" : "border-border bg-elevated"} ${seat.alive ? "" : "opacity-45"}`}
                    >
                      <span className="text-lg font-bold leading-none">{seat.number}</span>
                      <span className="mt-1 w-full truncate text-[9px] leading-tight sm:text-xs">{seat.localNickname}</span>
                      {showRoles && seat.role && <span className={`text-[9px] ${seat.role === "don" || seat.role === "mafia" ? "text-muted" : "text-error"}`}>{sideName[seat.role]}</span>}
                    </button>
                  ))}
                  <div aria-label={`Ведущий: ${draft.host?.localNickname ?? "не указан"}`} className="absolute bottom-[-3%] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-accent/70 bg-canvas px-4 py-1 text-xs font-semibold">Ведущий · {draft.host?.localNickname}</div>
                </div>
                <p className="mt-5 text-center text-xs text-muted">Места 1 и 10 — рядом с ведущим; 5 и 6 — напротив. Нажмите на место для действия.</p>
              </section>

              {selectedSeat && <Section title={`Место ${selected} · ${selectedSeat.localNickname}`}>
                <div className="mb-4 flex flex-wrap gap-2 text-sm text-muted">
                  <span>{selectedSeat.alive ? "В игре" : "Выбыл"}</span>
                  <span>· Фолы {selectedSeat.fouls}/4</span>
                  <span>· Технические {selectedSeat.technical}/2</span>
                  {showRoles && <span>· {selectedSeat.role ? sideName[selectedSeat.role] : "Роль не указана"}</span>}
                </div>
                {table?.phase === "setup" && (
                  <form key={`${draft.draftId}-${selected}-${draft.clientRevision}`} className="space-y-3" onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    const name = String(data.get("nickname") ?? "").trim();
                    const role = String(data.get("role") ?? "") as "" | "civilian" | "sheriff" | "mafia" | "don";
                    const changes: Command[] = [];
                    if (name !== selectedSeat.localNickname) changes.push({ type: "seat_assigned", seat: selected, name });
                    if ((role || null) !== selectedSeat.role) changes.push({ type: "role_recorded", seat: selected, role: role || null });
                    runBatch(changes);
                  }}>
                    <label className="block space-y-1 text-sm">Игровой никнейм<input name="nickname" required maxLength={64} defaultValue={selectedSeat.localNickname} className={field} /></label>
                    <label className="block space-y-1 text-sm">Закрытая роль<select name="role" defaultValue={selectedSeat.role ?? ""} className={field}><option value="">Не указана</option><option value="civilian">Мирный</option><option value="sheriff">Шериф</option><option value="mafia">Мафия</option><option value="don">Дон</option></select></label>
                    <button type="submit" className={accent}>Сохранить игрока и роль</button>
                  </form>
                )}
                {table?.phase !== "setup" && !table?.result && selectedSeat.alive && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={button} onClick={() => run({ type: "ordinary_foul", seat: selected })}>+ Фол</button>
                    <button type="button" className={button} onClick={() => { if (reason.trim()) run({ type: "technical_warning_manual", seat: selected, reason: reason.trim() }); else setError("Укажите причину технического предупреждения"); }}>Техническое</button>
                    <button type="button" className={button} onClick={() => { if (!reason.trim()) { setError("Укажите причину удаления"); return; } if (window.confirm(`Удалить место ${selected}?`)) run({ type: "removed", seat: selected, reason: reason.trim() }); }}>Удалить</button>
                    {table?.phase === "day" && <button type="button" className={accent} onClick={() => run({ type: "speech_started", seat: selected })}>Начать речь</button>}
                  </div>
                )}
                {table?.phase !== "setup" && !table?.result && <label className="mt-3 block space-y-1 text-sm">Причина для предупреждения/удаления<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className={field} placeholder="Фактическое основание" /></label>}
              </Section>}

              <Section title="Журнал и восстановление">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={button} disabled={!undoState?.active.length} onClick={() => { const last = undoState?.active.at(-1); if (last) run({ type: "observation_undone", target: last.id, reason: "Ручная отмена ведущим" }); }}>Отменить</button>
                  <button type="button" className={button} disabled={!undoState?.redo.length} onClick={() => { const last = undoState?.redo.at(-1); if (last) run({ type: "observation_redone", target: last.id, reason: "Возврат действия ведущим" }); }}>Повторить</button>
                  <button type="button" className={accent} onClick={exportFile}>Экспорт JSON</button>
                  <label className={`${button} cursor-pointer`}>Импорт JSON<input className="sr-only" type="file" accept=".json,application/json" onChange={importFile} /></label>
                </div>
                <ol className="mt-4 max-h-48 space-y-1 overflow-y-auto text-xs text-muted">
                  {draft.events.slice(-12).reverse().map((event) => <li key={event.id}>№{event.sequence} · {event.phase} · {event.command.type}</li>)}
                </ol>
                <p className="mt-3 text-xs text-warning">Не удаляйте данные браузера до экспорта. Для официальной партии пока нужен отдельный ввод результата в админке.</p>
              </Section>
            </div>

            <div className="space-y-5">
              <Section title="Таймер">
                <div aria-live="off" className={`text-center font-mono text-6xl font-bold tabular-nums ${timerSeconds <= 10 ? "text-error" : "text-text"}`}>{prettyTime(timerSeconds)}</div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" className={accent} disabled={timerRunning || timerSeconds === 0} onClick={() => { deadlineRef.current = Date.now() + timerSeconds * 1000; setTimerRunning(true); }}>Старт</button>
                  <button type="button" className={button} disabled={!timerRunning} onClick={pauseTimer}>Пауза</button>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">{[20, 30, 60].map((seconds) => <button key={seconds} type="button" className={button} onClick={() => { deadlineRef.current = null; setTimerRunning(false); setTimerSeconds(seconds); }}>{seconds} сек.</button>)}</div>
                <p className="mt-3 text-xs text-muted">При сворачивании или блокировке устройства таймер ставится на паузу. Проверьте реальное время перед продолжением.</p>
              </Section>

              {table?.phase === "setup" && <Section title="Начало партии">
                <p className="mb-3 text-sm text-muted">Состав ролей: {readyRoles ? "подтверждён" : "ещё не полный"}. Ведущий: {draft.host?.localNickname}.</p>
                <button type="button" className={accent} onClick={() => run({ type: "phase_started", next: "night" })}>Начать первую ночь (N0)</button>
              </Section>}

              {table?.phase === "night" && !table.result && <Section title={`Ночные действия · N${table.round}`}>
                {shotRequired && !table.shot && <div className="mb-4 space-y-3">
                  <p className="text-sm font-semibold">Отстрел</p>
                  <select className={field} value={effectiveTarget} onChange={(e) => setTargetSeat(Number(e.target.value))}>{seatOptions}</select>
                  <div className="flex flex-wrap gap-2">
                    <button className={button} type="button" onClick={() => run({ type: "shot_observation", mode: "target", target: effectiveTarget })}>Цель {effectiveTarget}</button>
                    <button className={button} type="button" onClick={() => run({ type: "shot_observation", mode: "miss" })}>Промах</button>
                    <button className={button} type="button" onClick={() => run({ type: "shot_observation", mode: "unknown" })}>Неизвестно</button>
                  </div>
                </div>}
                {(table.round > 0 || draft.format === "short9") && !table.nightResolved && <div className="mb-4 space-y-3">
                  <p className="text-sm font-semibold">Проверки: Дон → Шериф</p>
                  <select className={field} value={checkKind} onChange={(e) => { setCheckKind(e.target.value as "don" | "sheriff"); setCheckResult("unknown"); }}><option value="don">Дон</option><option value="sheriff">Шериф</option></select>
                  <select className={field} value={checkTarget} onChange={(e) => setCheckTarget(e.target.value)}><option value="0">Цель отсутствует / не установлена</option>{seatOptions}</select>
                  <select className={field} value={checkResult} onChange={(e) => setCheckResult(e.target.value)}>
                    <option value="unknown">Неизвестно</option><option value="absent">Нет проверки</option>
                    {checkKind === "don" ? <><option value="sheriff">Шериф</option><option value="not_sheriff">Не шериф</option></> : <><option value="red">Красный</option><option value="black">Чёрный</option></>}
                  </select>
                  <button type="button" className={button} onClick={() => run({ type: "role_check", kind: checkKind, target: checkTarget === "0" ? null : Number(checkTarget), result: checkResult as "unknown" | "absent" | "red" | "black" | "sheriff" | "not_sheriff" })}>Зафиксировать проверку</button>
                  <p className="text-xs text-muted">Отмечено проверок: {table.checks.length}/2. Неизвестные события не додумываются.</p>
                </div>}
                {!table.nightResolved ? <div className="space-y-3">
                  {(table.round > 0 || draft.format === "short9") && table.checks.length !== 2 && <label className="flex items-start gap-2 text-sm text-warning"><input className="mt-1" type="checkbox" checked={confirmGaps} onChange={(e) => setConfirmGaps(e.target.checked)} />Я подтверждаю, что недостающие проверки действительно не наблюдались. Не выдумывать результат.</label>}
                  <button type="button" className={accent} disabled={(table.round > 0 || draft.format === "short9") && table.checks.length !== 2 && !confirmGaps} onClick={() => { if (run({ type: "night_result", unobservedConfirmed: confirmGaps })) setConfirmGaps(false); }}>Завершить ночь</button>
                </div> : (
                  <div className="space-y-3">
                    {table.bestEligible !== null && !table.bestTrio && <div className="space-y-2">
                      <p className="text-sm">Лучший ход места {table.bestEligible}: три номера через запятую</p>
                      <input className={field} value={bestTrio} onChange={(e) => setBestTrio(e.target.value)} placeholder="1, 2, 3" />
                      <button type="button" className={button} onClick={() => run({ type: "best_move", trio: bestTrio.split(",").map(Number) as [number, number, number] })}>Сохранить лучший ход</button>
                    </div>}
                    <button type="button" className={accent} onClick={() => run({ type: "phase_started", next: "day" })}>Перейти к дню</button>
                  </div>
                )}
              </Section>}

              {table?.phase === "day" && !table.result && <Section title={`Дневные действия · D${table.round}`}>
                {!table.vote && <div className="space-y-3">
                  <p className="text-sm text-muted">Выбранное место {selected} выставляет кандидата:</p>
                  <select className={field} value={effectiveTarget} onChange={(e) => setTargetSeat(Number(e.target.value))}>{seatOptions}</select>
                  <button type="button" className={button} onClick={() => run({ type: "nomination_accepted", actor: selected, target: effectiveTarget })}>Выставить {effectiveTarget}</button>
                  <p className="text-xs text-muted">Кандидаты: {table.nominations.map((x) => x.target).join(", ") || "нет"}</p>
                  <button type="button" className={accent} onClick={() => run({ type: "vote_started" })}>Начать голосование</button>
                </div>}
                {table.vote?.status === "open" && <div className="space-y-3">
                  <p className="text-sm">Стадия {table.vote.stage} · голоса по кандидатам</p>
                  {table.vote.candidates.map((num) => <label key={`${table.vote?.stage}-${num}`} className="flex items-center justify-between gap-4 text-sm">Место {num}<input type="number" min={0} max={table.seats.filter((x) => x.alive).length} className={`${field} max-w-24`} value={counts[num] ?? 0} onChange={(e) => setCounts((prev) => ({ ...prev, [num]: Number(e.target.value) }))} /></label>)}
                  <button type="button" className={button} onClick={() => run({ type: "votes_counted", counts: table.vote!.candidates.map((num) => counts[num] ?? 0), source: "referee_count_only" })}>Записать голоса</button>
                  <button type="button" className={accent} onClick={() => run({ type: "vote_stage_closed" })}>Завершить стадию голосования</button>
                </div>}
                {table.vote?.status === "defense" && <div className="space-y-2"><p className="text-sm">Защита кандидатов: {table.vote.candidates.join(", ")}</p>{table.vote.candidates.filter((num) => !table.vote?.defended.includes(num)).map((num) => <button key={num} type="button" className={button} onClick={() => { if (run({ type: "tie_defense", seat: num })) { setTimerSeconds(30); setTimerRunning(false); deadlineRef.current = null; } }}>Защита места {num} · 30 сек.</button>)}</div>}
                {table.vote?.status === "joint" && <div className="space-y-3"><p className="text-sm">Голосование за совместный выход</p><input type="number" min={0} max={table.seats.filter((x) => x.alive).length} className={field} value={jointYes} onChange={(e) => setJointYes(Number(e.target.value))} /><button type="button" className={button} onClick={() => run({ type: "joint_exit_yes_vote", yes: jointYes })}>Записать голоса «за»</button></div>}
                {(table.vote?.status === "ready" || table.vote?.status === "cancelled") && <button type="button" className={accent} onClick={() => run({ type: "day_result" })}>Объявить дневной итог</button>}
                {(table.vote?.status === "announced" || table.vote?.status === "cancelled") && <button type="button" className={`${button} mt-3`} onClick={() => run({ type: "phase_started", next: "night" })}>Следующая ночь</button>}
              </Section>}

              {!table?.result && table?.phase !== "setup" && <Section title="Завершение партии">
                <form className="space-y-3" onSubmit={(e) => {
                  e.preventDefault();
                  run({ type: "game_finished", outcome: finishOutcome, winner: finishOutcome === "draw" || finishOutcome === "cancelled" ? null : finishWinner, basis: finishBasis, confidence: "observed" });
                }}>
                  <p className="text-xs text-muted">Подсказка движка: {table ? (suggestedResult(table) ?? "исход не установлен") : "нет партии"}. Итог всегда подтверждает ведущий.</p>
                  <label className="block space-y-1 text-sm">Тип результата<select className={field} value={finishOutcome} onChange={(e) => setFinishOutcome(e.target.value as typeof finishOutcome)}><option value="normal">Обычный</option><option value="technical">Технический</option><option value="draw">Ничья</option><option value="cancelled">Без результата</option></select></label>
                  {finishOutcome !== "draw" && finishOutcome !== "cancelled" && <label className="block space-y-1 text-sm">Победитель<select className={field} value={finishWinner} onChange={(e) => setFinishWinner(e.target.value as "red" | "black")}><option value="red">Красные</option><option value="black">Чёрные</option></select></label>}
                  <label className="block space-y-1 text-sm">Основание (не менее 8 символов)<textarea className={`${field} min-h-24`} value={finishBasis} onChange={(e) => setFinishBasis(e.target.value)} maxLength={1000} placeholder="Что фактически произошло?" /></label>
                  <button type="submit" className={accent}>Завершить локальный протокол</button>
                </form>
              </Section>}

              {table?.result && <Section title="Игра завершена — не утверждена">
                <p className="text-sm">{table.result.outcome} · {table.result.winner ?? "без победителя"}</p>
                <p className="mt-2 text-sm text-muted">{table.result.basis}</p>
                <p className="mt-2 text-xs text-warning">Это не отправляет результат в Supabase. Сохраните JSON и проверьте протокол перед ручным внесением.</p>
              </Section>}

              <Section title="Другие локальные протоколы">
                <div className="space-y-2">
                  {[...new Map([...archive, { draftId: draft.draftId, title: draft.title, format: draft.format, updatedAt: "" }].map((x) => [x.draftId, x])).values()].filter((x) => x.draftId !== draft.draftId).map((item) => (
                    <button key={item.draftId} type="button" className={`${button} w-full text-left`} onClick={() => chooseDraft(item.draftId)}>{item.title} · {item.format}</button>
                  ))}
                  <button type="button" className={`${button} w-full`} onClick={() => { setDraft(null); setArchive((items) => [
                    { draftId: draft.draftId, title: draft.title, format: draft.format, updatedAt: new Date().toISOString() },
                    ...items.filter((x) => x.draftId !== draft.draftId),
                  ]); }}>Новая партия (текущая останется в архиве)</button>
                </div>
              </Section>
            </div>
          </div>
        </>
      )}

      {!draft && loaded && archive.length > 0 && <Section title="Сохранённые локальные партии"><div className="grid gap-2 sm:grid-cols-2">{archive.map((item) => <button key={item.draftId} className={`${button} text-left`} type="button" onClick={() => chooseDraft(item.draftId)}>{item.title} · {item.format}</button>)}</div><div className="mt-4"><label className={`${button} inline-flex cursor-pointer`}>Импорт JSON<input type="file" accept=".json,application/json" className="sr-only" onChange={importFile} /></label></div></Section>}
      {!draft && loaded && archive.length === 0 && <div className="text-sm text-muted"><label className={`${button} inline-flex cursor-pointer`}>Восстановить JSON<input type="file" accept=".json,application/json" className="sr-only" onChange={importFile} /></label></div>}

      {covered && <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-[#07090b] p-8 text-center" role="dialog" aria-modal="true" aria-label="Экран скрыт">
        <span className="font-display text-4xl font-semibold tracking-widest">MAFIA LEAGUE</span>
        <p className="max-w-md text-muted">Приватные данные ведущего скрыты. Для продолжения нажмите кнопку или Esc.</p>
        <button type="button" className={accent} onClick={() => setCovered(false)}>Вернуться к пульту</button>
      </div>}
    </div>
  );
}
