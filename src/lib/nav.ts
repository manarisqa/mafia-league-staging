export const NAV_ITEMS = [
  { href: "/", label: "Главная", key: "home" },
  { href: "/evenings", label: "Вечера", key: "evenings" },
  { href: "/players", label: "Игроки", key: "players" },
  { href: "/rating", label: "Рейтинг", key: "rating" },
  { href: "/history", label: "История", key: "history" },
  { href: "/learn", label: "Обучение", key: "learn" },
] as const;

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
