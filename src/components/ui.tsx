import type { Locale } from "@/lib/i18n/messages";
import { siteText } from "@/lib/i18n/site";
import Link from "next/link";
import type { ReactNode } from "react";

export function DemoBadge({ locale = "ru" }: { locale?: Locale }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-accent/50 bg-accent/10 px-2.5 py-0.5 text-xs text-accent-text">
      {siteText(locale, "Демонстрационные данные")}
    </span>
  );
}

export function Card({
  title,
  demo,
  locale,
  className = "",
  children,
}: {
  title?: string;
  demo?: boolean;
  locale?: Locale;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-card border border-border bg-surface p-5 sm:p-6 ${className}`}>
      {(title || demo) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-display text-xl font-bold">{title}</h2>}
          {demo && <DemoBadge locale={locale} />}
        </div>
      )}
      {children}
    </div>
  );
}

const buttonBase =
  "inline-flex h-12 items-center justify-center rounded-control px-6 font-medium transition-colors";

export function ButtonLink({
  href,
  variant = "primary",
  children,
}: {
  href: string;
  variant?: "primary" | "outline";
  children: ReactNode;
}) {
  const style =
    variant === "primary"
      ? "bg-accent hover:bg-accent-hover"
      : "border border-border hover:border-accent-text";
  return (
    <Link href={href} className={`${buttonBase} ${style}`}>
      {children}
    </Link>
  );
}

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-accent/60 bg-elevated font-display text-sm text-text"
    >
      {name.slice(0, 1)}
    </span>
  );
}

export function PageHero({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(170,35,53,0.3),transparent_60%)]"
      />
      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="max-w-3xl font-display text-4xl leading-tight font-bold sm:text-5xl">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">{subtitle}</p>
        {children}
      </div>
    </section>
  );
}
