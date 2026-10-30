import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import { Suspense } from "react";
import { Footer } from "@/components/footer";
import { AuthButton, AuthLinks } from "@/components/auth-button";
import { Header } from "@/components/header";
import { Logo } from "@/components/logo";
import { LocaleBoundary } from "@/components/locale-boundary";
import "./globals.css";

const ui = Inter({
  variable: "--font-ui",
  subsets: ["latin", "cyrillic"],
});

const display = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: {
    default: "Mafia League — Грац, Австрия",
    template: "%s · Mafia League",
  },
  description:
    "Клуб спортивной Мафии в Граце: игровые вечера, рейтинг игроков и обучение для новичков.",
};

export const viewport: Viewport = {
  themeColor: "#090a0c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" suppressHydrationWarning className={`${ui.variable} ${display.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Suspense fallback={<div className="p-6" role="status">Mafia League…</div>}>
        <LocaleBoundary>
          {/* Header читает адрес страницы, на динамических адресах это нужно делать в Suspense. */}
          <Suspense
            fallback={
              <header className="h-16 border-b border-border bg-canvas">
                <div className="mx-auto flex h-full max-w-7xl items-center px-4 sm:px-6">
                  <Logo />
                </div>
              </header>
            }
          >
            <Header
              authBar={
                <Suspense fallback={<AuthLinks variant="bar" />}>
                  <AuthButton variant="bar" />
                </Suspense>
              }
              authMenu={
                <Suspense fallback={<AuthLinks variant="menu" />}>
                  <AuthButton variant="menu" />
                </Suspense>
              }
            />
          </Suspense>
          <main className="flex-1">{children}</main>
          <Footer />
        </LocaleBoundary>
        </Suspense>
      </body>
    </html>
  );
}
