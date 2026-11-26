export const NAV_ITEMS = [
  { href: "/", label: "Главная", key: "home" },
  { href: "/evenings", label: "Игры", key: "games" },
  { href: "/players", label: "Игроки", key: "players" },
  { href: "/rating", label: "Рейтинг", key: "rating" },
  { href: "/learn", label: "Обучение", key: "learn" },
] as const;

export function isActive(pathname: string, href: string) {
  if (href === "/evenings" && pathname.startsWith("/history")) return true;
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
