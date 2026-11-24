import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap sm:gap-3" aria-label="Mafia League — на главную">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center sm:size-10 justify-center rounded-control bg-accent font-display text-xl font-bold text-text"
      >
        M
      </span>
      <span className="leading-tight">
        <span className="block font-display text-sm tracking-[0.08em] sm:text-xl sm:tracking-[0.12em]">
          MAFIA LEAGUE
        </span>
        <span className="block text-[10px] tracking-[0.2em] sm:text-[11px] sm:tracking-[0.3em] text-muted uppercase">
          Graz · Austria
        </span>
      </span>
    </Link>
  );
}
