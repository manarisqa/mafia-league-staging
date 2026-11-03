import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/login/actions";
import { requireAdmin } from "@/lib/auth";

export const metadata: Metadata = {
  title: { default: "Админка", template: "%s" },
  robots: { index: false },
};

const NAV = [
  { href: "/admin", label: "Обзор" },
  { href: "/admin/evenings", label: "Вечера" },
  { href: "/admin/games", label: "Партии" },
  { href: "/admin/referee", label: "Ведущий" },
  { href: "/admin/players", label: "Игроки" },
];

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<p className="px-4 py-10 text-muted sm:px-6">Загрузка…</p>}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}

// Проверка прав происходит здесь (во время запроса), а не в самом layout,
// иначе вся страница ждала бы ответа от базы.
async function AdminShell({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <nav aria-label="Разделы админки" className="flex flex-wrap gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="inline-flex min-h-11 items-center rounded-control px-4 text-sm text-muted hover:bg-surface hover:text-text"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <form action={signOut} className="flex items-center gap-3 text-sm text-muted">
          <span className="hidden sm:inline">{user.email}</span>
          <button type="submit" className="min-h-11 rounded-control border border-border px-4 hover:border-accent-text">
            Выйти
          </button>
        </form>
      </div>
      {children}
    </div>
  );
}
