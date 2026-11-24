"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { type Action, type Draft } from "@/lib/referee/guided/protocol";
import { alive, checkAnswer, focusSeat, remainingVotes, replay, roleLimit, roleOrder, timing, type State } from "@/lib/referee/guided/reducer";
import { Board } from "./board";
import { clockText, useClock } from "./clock";
import type { Translate, Word } from "./words";

type Act = (action: Action) => Promise<Draft | null>;

export function Sheet({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog className="ref-sheet" ref={ref} onCancel={(e) => { e.preventDefault(); close(); }} aria-label={title}>
    <div className="ref-row"><h3>{title}</h3><button className="ref-close" aria-label="×" onClick={close}>×</button></div>
    {children}
  </dialog>;
}

export function PrivateRoster({ draft, state, t }: { draft: Draft; state: State; t: Translate }) {
  return <ol className="ref-review-roster">{state.seats.map((p, index) =>
    <li key={p.number}>
      <span><b>{p.number}</b> {draft.players[index].name}</span>
      <span>{p.role ? t(p.role) : "—"} · {t("foul")} {p.fouls}{p.removed ? " · " + t("remove") : ""}</span>
    </li>)}</ol>;
}

export function RoleCorrection({ draft, state, t, act, close }: {
  draft: Draft; state: State; t: Translate; act: Act; close: () => void;
}) {
  const [pair, setPair] = useState<number[]>([]);
  const [reason, setReason] = useState("");
  const valid = pair.length === 2 && state.seats[pair[0] - 1].role !== state.seats[pair[1] - 1].role;
  return <Sheet close={close} title={t("roleSwap")}>
    <Board format={draft.format} players={draft.players} t={t} selected={pair}
      enabled={state.seats.filter((p) => p.role).map((p) => p.number)}
      onSeat={(n) => setPair((prior) => prior.includes(n) ? prior.filter((x) => x !== n) : prior.length === 2 ? [n] : [...prior, n])} />
    {pair.length > 0 && <p>{pair.map((n) => n + " · " + t(state.seats[n - 1].role!)).join(" / ")}</p>}
    <label>{t("reason")}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
    <button type="button" className="primary" disabled={!valid || reason.trim().length < 3}
      onClick={async () => { if (await act({ type: "roleSwap", first: pair[0], second: pair[1], reason })) close(); }}>
      {t("correctionSaved")}
    </button>
  </Sheet>;
}

function Discipline({ draft, state, t, act, close }: {
  draft: Draft; state: State; t: Translate; act: Act; close: () => void;
}) {
  const [seat, select] = useState<number | null>(null);
  const [kind, setKind] = useState<"technical" | "remove" | null>(null);
  const [reason, setReason] = useState("");
  const player = seat ? state.seats[seat - 1] : null;
  return <Sheet close={close} title={t("discipline")}>
    {!player ? <>
      <p>{t("foulPlayer")}</p>
      <Board format={draft.format} players={draft.players} t={t} enabled={alive(state).map((p) => p.number)}
        dead={state.seats.filter((p) => !p.alive).map((p) => p.number)} onSeat={select} />
    </> : <>
      <h4>{player.number} · {draft.players[player.number - 1].name} · {t("foul")} {player.fouls}</h4>
      {player.debt && <p>{t("debt")}</p>}
      <div className="ref-actions">
        <button type="button" className="primary" onClick={async () => {
          if (await act({ type: "discipline", seat: player.number, kind: "ordinary" })) close();
        }}>{t("ordinary")}</button>
        <button type="button" onClick={() => setKind("technical")}>{t("technical")}</button>
        <button type="button" onClick={() => setKind("remove")}>{t("remove")}</button>
      </div>
      {kind && <>
        <label>{t("reason")}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
        <button type="button" className="primary" disabled={reason.trim().length < 3} onClick={async () => {
          if (await act({ type: "discipline", seat: player.number, kind, reason })) close();
        }}>{t(kind)}</button>
      </>}
    </>}
  </Sheet>;
}

function NightCheck({ draft, state, t, act, close, observed }: {
  draft: Draft; state: State; t: Translate; act: Act; close: () => void; observed: () => number | null;
}) {
  const [target, setTarget] = useState<number | null>(null);
  const role = state.step === "donCheck" ? "don" : "sheriff";
  const actor = state.seats.find((p) => p.role === role);
  const answer = target ? checkAnswer(state, target) : null;
  async function confirm(mode: "observed" | "unknown" | "absent" | "noTarget") {
    if (await act({
      type: "check", mode, seconds: observed(),
      ...(target && (mode === "observed" || mode === "unknown") ? { target } : {}),
      ...(mode === "observed" && answer ? { answer } : {}),
    })) close();
  }
  return <Sheet close={close} title={t(role === "don" ? "donCheck" : "sheriffCheck")}>
    {actor?.alive ? <>
      <Board format={draft.format} players={draft.players} t={t} selected={target ? [target] : []}
        enabled={state.seats.filter((p) => checkAnswer(state, p.number)).map((p) => p.number)} onSeat={setTarget} />
      {answer && <p className="ref-answer">{t(answer)} · {target}</p>}
    </> : <p>{t("absent")}</p>}
    <div className="ref-actions">
      {answer && <button type="button" className="primary" onClick={() => confirm("observed")}>{t("confirmCheck")}</button>}
      <button type="button" onClick={() => confirm(actor?.alive ? "noTarget" : "absent")}>{t(actor?.alive ? "noTarget" : "absent")}</button>
      <button type="button" onClick={() => confirm("unknown")}>{t("unknown")}</button>
    </div>
  </Sheet>;
}

function Exception({ t, act, close }: { t: Translate; act: Act; close: () => void }) {
  const [value, setValue] = useState<"red" | "black" | "cancelled">("cancelled");
  const [reason, setReason] = useState("");
  return <Sheet close={close} title={t("technicalResult")}>
    <select aria-label={t("finish")} value={value} onChange={(e) => setValue(e.target.value as typeof value)}>
      {(["cancelled", "red", "black"] as const).map((k) => <option key={k} value={k}>{t(k)}</option>)}
    </select>
    <label>{t("reason")}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
    <button type="button" className="primary" disabled={reason.trim().length < 3} onClick={async () => {
      if (await act({ type: "exception", outcome: value === "cancelled" ? "cancelled" : "technical",
        ...(value !== "cancelled" ? { winner: value } : {}), reason })) close();
    }}>{t("finish")}</button>
  </Sheet>;
}

const advanceButtons: Partial<Record<State["step"], Word>> = {
  ready: "startGame", donAck: "next", morning: "morning", speech: "pass",
  dayAnnounce: "dayAnnounce", nightReady: "startNight", resolveNight: "resolveNight",
  agreement: "agreementEnd", seating: "end", sheriffAck: "end", defense: "end", last: "end",
};
const titles: Partial<Record<State["step"], Word>> = {
  roles: "roles", ready: "roleReady", agreement: "agreement", donAck: "donAck", sheriffAck: "sheriffAck",
  seating: "seating", morning: "morning", speechReady: "speech", speech: "speech",
  voteReady: "voteReady", count: "count", confirmVote: "confirmVote", defense: "defense", joint: "joint",
  dayAnnounce: "dayAnnounce", nightReady: "nightReady", last: "last", shot: "shot", donCheck: "nightWindow",
  sheriffCheck: "nightWindow", resolveNight: "resolveNight", best: "best", finish: "finish",
};
const hints: Partial<Record<State["step"], Word>> = {
  roles: "roleHint", agreement: "agreementHint", donAck: "donAckHint", sheriffAck: "sheriffAckHint",
  shot: "shotHint", best: "bestHint",
};

export function Live({ draft, state, t, act, tools, disabled, overlay }: {
  draft: Draft; state: State; t: Translate; act: Act; tools: () => void; disabled: boolean; overlay?: ReactNode;
}) {
  const [locked, setLocked] = useState(false);
  const { step } = state;
  const focus = focusSeat(state);
  const duration = timing(state);
  const clock = useClock(draft.id, state.timedBy, duration);
  useEffect(() => {
    const hide = () => { if (document.hidden) setLocked((value) => value || step === "roles"); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("dialog[open]")) setLocked(true); };
    const blur = () => { if (step === "roles") setLocked(true); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", key);
    };
  }, [step]);

  if (locked) return <div className="ref-lock"><h2>{t("locked")}</h2>
    <button type="button" className="primary" onClick={() => setLocked(false)}>{t("unlock")}</button></div>;

  const name = focus ? draft.players[focus - 1].name : "";
  const warning = duration === 10 || duration === 20 ? 5 : 10;
  const warningOn = clock.clock && clock.seconds <= warning;
  return <div className="ref-live" data-step={step} aria-busy={disabled}>
    <div className="ref-live-header">
      <div>
        <span className="ref-overline">{t(state.phase === "setup" ? "planned" : state.phase === "night" ? "night" : "day")}
          {state.phase !== "setup" && " " + (state.phase === "night" ? state.night : state.day)}</span>
        <h2>{t(step === "speech" && state.speechSeconds === 10 ? "nomination" : titles[step] ?? "next")}</h2>
        {focus && <p className="ref-focus">{focus} · {name}</p>}
      </div>
      {duration !== null && <div className="ref-time">
        <output className={warningOn ? "urgent" : ""} aria-label={t("start")} data-timer>{clockText(clock.seconds)}</output>
        {clock.clock?.status === "uncertain" ? <small>{t("uncertain")}</small>
          : clock.seconds === 0 ? <small role="status">{t("elapsed")}</small> : null}
        {clock.clock && (clock.clock.status !== "running" || clock.seconds > 0) &&
          <button type="button" onClick={clock.clock.status === "running" ? clock.pause : clock.resume}>
            {t(clock.clock.status === "running" ? "pauseTimer" : "resume")}
          </button>}
      </div>}
    </div>
    <Procedure key={state.timedBy} draft={draft} state={state} t={t} act={act} clock={clock}
      disabled={disabled} lock={() => { clock.pause(); setLocked(true); }} tools={tools} />
    {overlay}
  </div>;
}

function Procedure({ draft, state, t, act, clock, disabled, lock, tools }: {
  draft: Draft; state: State; t: Translate; act: Act; clock: ReturnType<typeof useClock>;
  disabled: boolean; lock: () => void; tools: () => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [joint, setJoint] = useState<number | null>(null);
  const [sheet, setSheet] = useState<"foul" | "check" | "exception" | null>(null);
  const [unknown, setUnknown] = useState(false);
  const { step } = state;
  const focus = focusSeat(state);
  const live = alive(state).map((p) => p.number);
  const dead = state.seats.filter((p) => !p.alive).map((p) => p.number);
  const nomination = step === "speech" && !state.vote.cancelled && !state.nominations.some((p) => p.actor === focus);
  const enabled = nomination ? live.filter((n) => !state.nominations.some((p) => p.target === n))
    : step === "shot" ? live : step === "best" ? state.seats.map((p) => p.number).filter((n) => n !== state.nightExit) : [];
  const canDiscipline = state.phase !== "setup" && !state.terminal;
  const isCheck = step === "donCheck" || step === "sheriffCheck";
  const seatClick = enabled.length ? (n: number) => {
    if (disabled) return;
    if (nomination) void act({ type: "nominate", target: n });
    else if (step === "shot") setSelected((list) => list[0] === n ? [] : [n]);
    else setSelected((list) => list.includes(n) ? list.filter((x) => x !== n) : list.length < 3 ? [...list, n] : list);
  } : undefined;

  useEffect(() => {
    const hide = () => setSheet((prev) => prev === "check" ? null : prev);
    const visibility = () => { if (document.hidden) hide(); };
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("blur", hide); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  function button(label: Word, action: () => void, primary = false, gate = true) {
    return <button type="button" className={primary ? "primary" : ""} disabled={disabled || !gate} onClick={action}>{t(label)}</button>;
  }

  const advance = () => { void act({ type: "advance", seconds: clock.observed }); };
  const timed = timing(state) !== null;
  const labels = (numbers: number[]) => numbers.map((n) => "№" + n).join(" · ");

  return <>
    {hints[step] && <p className="ref-hint">{t(hints[step])}</p>}
    <Board players={draft.players} format={draft.format} selected={selected.length ? selected : focus ? [focus] : []}
      dead={dead} onSeat={seatClick} enabled={enabled} t={t} />
    <div className="ref-procedure">
      {step === "roles" && focus && <div className="ref-role-grid" aria-label={t("roles")}>
        {roleOrder.map((role) => {
          const left = roleLimit(draft.format, role) - state.seats.filter((p) => p.role === role).length;
          return <button type="button" key={role} disabled={!left || disabled}
            onClick={() => void act({ type: "role", seat: focus, role })}>{t(role)} <b>{left}</b></button>;
        })}
      </div>}
      {nomination && <p className="ref-hint">{t("nominate")} · {t("nominated")} {labels(state.nominations.map((p) => p.target)) || "—"}</p>}
      {step === "speechReady" && button(state.seats[focus! - 1].debt && ![3, 4].includes(live.length) ? "nextNomination" : "nextSpeech",
        async () => {
          const next = await act({ type: "speechStart" });
          if (next) clock.start(next.events.at(-1)!.id);
        }, true)}
      {step === "voteReady" && <>
        <p>{state.nominations.length > 1 ? labels(state.nominations.map((p) => p.target)) :
          t(state.nominations.length === 0 ? "noVote" : state.day === 1 ? "oneD1" : "oneLater")}</p>
        {button(state.nominations.length > 1 ? "countStart" : "voteStart", advance, true)}
      </>}
      {step === "count" && <>
        <p>{t("remaining")} <b>{remainingVotes(state)}</b> · {t("unset")}</p>
        <Palette max={remainingVotes(state)} disabled={disabled} select={(value) => void act({ type: "count", value })} />
      </>}
      {step === "confirmVote" && <>
        <p>{state.vote.candidates.map((n, index) => "№" + n + " · " + state.vote.counts[index]).join(" / ")}</p>
        <p>{t("residual")} <b>{remainingVotes(state)}</b></p>
        {button("confirmVote", () => void act({ type: "confirmVote" }), true)}
      </>}
      {step === "joint" && <>
        <p>{labels(state.vote.candidates)} · {t("strict")} <b>{Math.floor(live.length / 2) + 1}</b></p>
        <Palette max={live.length} disabled={disabled} select={setJoint} current={joint} />
        {button("confirmJoint", () => void act({ type: "joint", yes: joint! }), true, joint !== null)}
      </>}
      {step === "dayAnnounce" && <p>{state.vote.cancelled ? t("voteCancelled") :
        state.vote.exits.length ? t("exits") + " " + labels(state.vote.exits) : t("noExit")}</p>}
      {step === "morning" && state.nightExit && <p>{t("morningAfterKill")} {labels([state.nightExit])}</p>}
      {state.vote.cancelled && !state.vote.announced && step !== "dayAnnounce" && <p className="ref-status">{t("voteCancelled")}</p>}
      {state.skipNext && <p className="ref-status">{t("skipNext")}</p>}
      {timed && !clock.clock && button("start", () => clock.start(), true)}
      {advanceButtons[step] && button(advanceButtons[step]!, advance, !timed || !!clock.clock)}
      {step === "shot" && <div className="ref-actions">
        {button("shotConfirm", () => void act({ type: "shot", target: selected[0] }), true, selected.length === 1)}
        {button("miss", () => void act({ type: "shotNone", mode: "miss" }))}
        {button("unknown", () => setUnknown(true))}
      </div>}
      {step === "shot" && unknown && <Sheet title={t("unknownShot")} close={() => setUnknown(false)}>
        {button("unknown", () => void act({ type: "shotNone", mode: "unknown" }), true)}
      </Sheet>}
      {isCheck && button("privateCheck", () => {
        if (!clock.clock) clock.start();
        setSheet("check");
      }, !!clock.clock)}
      {step === "best" && <div className="ref-actions">
        {button("bestConfirm", () => void act({ type: "best", targets: selected, seconds: clock.observed }), true, selected.length === 3)}
        {button("unknown", () => void act({ type: "best", targets: null, seconds: clock.observed }))}
      </div>}
      {step === "finish" && <>
        <p className="ref-result">{t(state.terminal ?? "cancelled")}</p>
        {button("finish", () => void act({ type: "finish" }), true)}
      </>}
    </div>
    <div className="ref-live-toolbar">
      {canDiscipline && button("foul", () => setSheet("foul"))}
      {button("privacy", lock)}
      {button("more", tools)}
      {canDiscipline && button("technicalResult", () => setSheet("exception"))}
    </div>
    {sheet === "foul" && canDiscipline && <Discipline draft={draft} state={state} t={t} act={act} close={() => setSheet(null)} />}
    {sheet === "check" && isCheck && <NightCheck draft={draft} state={state} t={t} act={act} observed={() => clock.observed} close={() => setSheet(null)} />}
    {sheet === "exception" && canDiscipline && <Exception t={t} act={act} close={() => setSheet(null)} />}
  </>;
}

function Palette({ max, disabled, select, current }: {
  max: number; disabled: boolean; select: (n: number) => void; current?: number | null;
}) {
  return <div className="ref-palette">{Array.from({ length: max + 1 }, (_, n) =>
    <button type="button" key={n} disabled={disabled} className={current === n ? "chosen" : ""}
      onClick={() => select(n)}>{n}</button>)}</div>;
}

export function UndoRedo({ draft, t, act }: { draft: Draft; t: Translate; act: Act }) {
  const { undo, redo } = replay(draft);
  return <div className="ref-actions">
    <button type="button" disabled={!undo} onClick={() => undo && void act({ type: "undo", target: undo, reason: t("correction") })}>{t("undo")}</button>
    <button type="button" disabled={!redo} onClick={() => redo && void act({ type: "redo", target: redo, reason: t("correction") })}>{t("redo")}</button>
  </div>;
}
