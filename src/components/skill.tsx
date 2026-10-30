import Link from "next/link";
import type { PlayerStats } from "@/lib/league/core";

type Skill = Pick<PlayerStats, "rating" | "sd" | "low" | "high" | "skillGames" | "provisional">;
export function SkillValue({ stats, compact = false }: { stats: Skill; compact?: boolean }) {
  if (!stats.skillGames) return <span className="text-sm text-muted">Нет оценки Classic10</span>;
  return <span className={compact ? "inline-flex flex-col gap-1" : "flex flex-col gap-2"}>
    <span className={compact ? "font-medium tabular-nums" : "font-display text-5xl font-bold tabular-nums"}>{Math.round(stats.rating)}</span>
    <span className="text-xs font-normal text-muted">{stats.provisional ? "Предварительная" : "League Skill"} · {stats.skillGames} игр</span>
    <span className="text-xs font-normal text-muted" title={`Стандартное отклонение: ${stats.sd.toFixed(2)}`}>Интервал 95%: {Math.round(stats.low)}–{Math.round(stats.high)}</span>
  </span>;
}
export type SkillPoint = { gameId: string | null; startsAt: string | null; rating: number; sd: number };
export function SkillChart({ points }: { points: SkillPoint[] }) {
  if (points.length < 2) return null;
  const stride = Math.max(1, Math.ceil(points.length / 120));
  const sampled = points.map((p, i) => ({ ...p, i })).filter((p) => p.i % stride === 0 || p.i === points.length - 1);
  const lo = Math.min(...points.map((p) => p.rating - 1.96 * p.sd));
  const hi = Math.max(...points.map((p) => p.rating + 1.96 * p.sd));
  const x = (i: number) => 10 + 300 * i / (points.length - 1);
  const y = (v: number) => 130 - 120 * (v - lo) / Math.max(hi - lo, 1);
  const band = [...sampled.map((p) => `${x(p.i)},${y(p.rating + 1.96 * p.sd)}`), ...sampled.toReversed().map((p) => `${x(p.i)},${y(p.rating - 1.96 * p.sd)}`)].join(" ");
  return <figure>
    <svg viewBox="0 0 320 140" role="img" aria-label={`League Skill: ${Math.round(points[0].rating)} → ${Math.round(points.at(-1)!.rating)}, с интервалом неопределённости 95%`} className="h-44 w-full">
      <polygon points={band} fill="var(--accent-text)" opacity="0.15" />
      <polyline points={sampled.map((p) => `${x(p.i)},${y(p.rating)}`).join(" ")} fill="none" stroke="var(--accent-text)" strokeWidth="2" />
    </svg>
    <figcaption className="text-xs text-muted">Оценка и интервал 95%. Уточняется после учитываемых партий всей лиги, в том числе без вашего участия.</figcaption>
    <details className="mt-3 text-sm"><summary className="cursor-pointer text-accent-text">Последние точки расчёта</summary>
      <ul className="mt-2 space-y-2">{points.slice(-30).map((p, i) => <li key={p.gameId ?? `base-${i}`}>
        {p.gameId ? <Link href={`/history/games/${p.gameId}`} className="hover:underline">{p.startsAt ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Vienna", day: "numeric", month: "short", year: "numeric" }).format(new Date(p.startsAt)) : "Партия"} · {Math.round(p.rating)} ({Math.round(p.rating - 1.96 * p.sd)}–{Math.round(p.rating + 1.96 * p.sd)}) →</Link> : "До первых учитываемых партий: 1000"}
      </li>)}</ul>
    </details>
  </figure>;
}
