"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/logo";
import { NAV_ITEMS, isActive } from "@/lib/nav";
import { LanguageSwitch, useTranslation } from "./locale-provider";

export function Header({ authBar, authMenu }: { authBar: ReactNode; authMenu: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  const close = () => setOpen(false);

  // Меню закрывается по клавише Escape и при выборе пункта.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Logo />

        <nav aria-label={t("navigation")} className="hidden h-full xl:block">
          <ul className="flex h-full items-center gap-1">
            {NAV_ITEMS.map(({ href, key }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href} className="h-full">
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex h-full items-center px-3 text-sm transition-colors hover:text-text ${
                      active ? "text-text" : "text-muted"
                    }`}
                  >
                    {t(key)}
                    {active && (
                      <span className="absolute inset-x-4 bottom-0 h-0.5 bg-accent" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden xl:block"><LanguageSwitch /></div>
          {authBar}
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-control border border-border bg-surface xl:hidden"
            aria-label={t(open ? "closeMenu" : "openMenu")}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              {open ? (
                <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              ) : (
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav
          id="mobile-menu"
          aria-label={t("mobileNavigation")}
          className="border-t border-border bg-canvas xl:hidden"
        >
          <ul className="mx-auto flex max-w-7xl flex-col px-4 py-2 sm:px-6">
            {NAV_ITEMS.map(({ href, key }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    onClick={close}
                    className={`flex min-h-12 items-center border-l-2 px-4 text-base ${
                      active
                        ? "border-accent text-text"
                        : "border-transparent text-muted hover:text-text"
                    }`}
                  >
                    {t(key)}
                  </Link>
                </li>
              );
            })}
            <li onClick={close}>{authMenu}</li>
            <li className="px-4 py-2"><LanguageSwitch /></li>
          </ul>
        </nav>
      )}
    </header>
  );
}
