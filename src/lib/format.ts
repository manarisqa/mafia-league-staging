import type { Locale } from "./i18n/messages";

const TZ = "Europe/Vienna";

/** Разбирает дату вечера для показа: «Сб», «15», «марта», «19:00». */
export function eveningParts(iso: string, locale: Locale = "ru") {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "long",
  }).formatToParts(d);
  const get = (type: string) => date.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  return {
    weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1),
    day: get("day"),
    month: get("month"),
    time: new Intl.DateTimeFormat(locale, {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
    }).format(d),
  };
}

/** «8 марта» */
export function shortDate(iso: string, locale: Locale = "ru") {
  return new Intl.DateTimeFormat(locale, {
    timeZone: TZ,
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

export const FORMAT_LABEL = {
  classic10: "Классика 10",
  short9: "Short9",
} as const;

export const STATUS_LABEL = {
  club_member: "Игрок клуба",
  newbie: "Новичок",
} as const;

/** Часть даты/времени в поясе Граца: год, месяц, день, час, минута (числами). */
function viennaParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: n("year"), mo: n("month"), d: n("day"), h: n("hour"), mi: n("minute") };
}

/** Для поля <input type="datetime-local">: «2026-11-14T19:00» по времени Граца. */
export function isoToViennaLocal(iso: string) {
  const p = viennaParts(new Date(iso));
  const z = (v: number) => String(v).padStart(2, "0");
  return `${p.y}-${z(p.mo)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

/**
 * Обратное преобразование: «2026-11-14T19:00» (местное время Граца) → ISO в UTC.
 * Возвращает null, если строка неверная или такого времени не существует.
 */
export function viennaLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = viennaParts(new Date(guess));
    const shown = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    guess += wanted - shown;
  }
  const back = viennaParts(new Date(guess));
  if (back.y !== y || back.mo !== mo || back.d !== d || back.h !== h || back.mi !== mi) return null;
  return new Date(guess).toISOString();
}

export const EVENING_STATUS_LABEL = {
  planned: "Запланирован",
  finished: "Проведён",
  cancelled: "Отменён",
} as const;

export const SIGNUP_STATUS_LABEL = {
  going: "Придёт",
  late: "Опоздает",
  maybe: "Возможно",
  not_going: "Не придёт",
} as const;

/** «14 ноября 2026, 19:00» — для админки. */
export function fullDateTime(iso: string, locale: Locale = "ru") {
  return new Intl.DateTimeFormat(locale, {
    timeZone: TZ,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export const ROLE_LABEL = {
  civilian: "Мирный",
  sheriff: "Шериф",
  don: "Дон",
  mafia: "Мафия",
} as const;

export const WINNER_LABEL = {
  red: "Красные (мирные)",
  black: "Чёрные (мафия)",
  draw: "Ничья",
} as const;

export const GAME_STATUS_LABEL = {
  in_progress: "Черновик",
  finished: "Завершена",
} as const;

/** «14 ноября 2026» */
export function longDate(iso: string, locale: Locale = "ru") {
  return new Intl.DateTimeFormat(locale, {
    timeZone: TZ,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

/** «сент. 2026» — для дат сезона (в базе это день без времени). */
export function monthYear(day: string, locale: Locale = "ru") {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short", year: "numeric" })
    .format(new Date(`${day}T00:00:00Z`))
    .replace(/ [гр]\.$/, "");
}

/** Склонение: plural(3, ["партия", "партии", "партий"]) → «партии». */
export function plural(n: number, [one, few, many]: [string, string, string]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «Красные», «Чёрные», «Ничья» — короткая подпись победителя. */
export const WINNER_SHORT = {
  red: "Красные",
  black: "Чёрные",
  draw: "Ничья",
} as const;

/** «сентября 2026» — для «В клубе с …» (в базе это день без времени). */
export function sinceMonth(day: string, locale: Locale = "ru") {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(new Date(`${day}T00:00:00Z`));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")} ${get("year")}`;
}

export const RESULT_LABEL = {
  win: "Победа",
  loss: "Поражение",
  draw: "Ничья",
} as const;
