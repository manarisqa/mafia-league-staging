"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clockKey, read, save } from "./local";

type Clock = { step: string; elapsed: number; wall: number; mono: number; status: "running" | "paused" | "uncertain"; unobserved?: boolean };
const time = () => ({ wall: Date.now(), mono: performance.now() });

function update(clock: Clock, duration: number): Clock {
  if (clock.status !== "running") return clock;
  const now = time();
  const wall = now.wall - clock.wall, mono = now.mono - clock.mono;
  const unstable = wall < 0 || mono < 0 || Math.abs(wall - mono) > 2500;
  const elapsed = Math.min(600_000, clock.elapsed + Math.max(0, wall, mono));
  return { ...clock, ...now, elapsed, status: unstable && elapsed < duration * 1000 ? "uncertain" : "running", unobserved: clock.unobserved || unstable };
}

export function useClock(id: string, step: string, duration: number | null) {
  const [stored, setStored] = useState<Clock | null>(null);
  const startedHere = useRef(new Set<string>());
  const key = clockKey(id) + "." + step;
  const clock = stored?.step === step ? stored : null;

  const persist = useCallback((value: Clock) => {
    try { save(clockKey(id) + "." + value.step, value); } catch { /* Draft persistence reports unavailable storage. */ }
    setStored(value);
  }, [id]);

  useEffect(() => {
    if (!duration || !id) return;
    const token = requestAnimationFrame(() => {
      const prior = read<Clock>(key);
      if (!prior || prior.step !== step) return;
      if (prior.status === "running" && !startedHere.current.has(step)) {
        persist({ ...prior, ...time(), elapsed: Math.min(600_000, prior.elapsed + Math.max(0, Date.now() - prior.wall)), status: "uncertain", unobserved: true });
      } else setStored(prior);
    });
    return () => cancelAnimationFrame(token);
  }, [duration, id, key, persist, step]);

  useEffect(() => {
    if (!duration || clock?.status !== "running") return;
    const tick = () => setStored((prior) => prior?.step === step ? update(prior, duration) : prior);
    const timer = setInterval(tick, 180);
    const pauseOnHide = () => {
      if (document.hidden) {
        setStored((prior) => {
          if (!prior || prior.step !== step) return prior;
          const current = update(prior, duration);
          return { ...current, status: current.status === "uncertain" ? "uncertain" : "paused" };
        });
      }
    };
    document.addEventListener("visibilitychange", pauseOnHide);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", pauseOnHide); };
  }, [clock?.status, duration, step]);

  useEffect(() => {
    if (!clock) return;
    try { save(key, clock); } catch { /* Keep the in-memory clock usable. */ }
  }, [clock, key]);

  const start = (clockStep = step) => {
    startedHere.current.add(clockStep);
    persist({ step: clockStep, ...time(), elapsed: 0, status: "running" });
  };
  const pause = () => {
    if (clock && duration) {
      const latest = update(clock, duration);
      persist({ ...latest, status: latest.status === "uncertain" ? "uncertain" : "paused" });
    }
  };
  const resume = () => { if (clock) persist({ ...clock, ...time(), status: "running" }); };
  const elapsed = clock && duration ? update(clock, duration).elapsed : null;
  const observed = elapsed !== null && !clock?.unobserved ? Math.round(elapsed / 100) / 10 : null;
  const seconds = Math.max(0, (duration ?? 0) - Math.floor((elapsed ?? 0) / 1000));

  return { clock, seconds, observed, start, pause, resume };
}

export const clockText = (seconds: number) =>
  String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
