import { z } from "zod";
import { fullDateTime } from "../format";
import type { Locale } from "../i18n/messages";

export const notificationCategory = z.enum(["announcement", "reminder", "ready", "change", "recap"]);
export const feedbackReason = z.enum(["schedule", "travel", "format", "uncertain", "other"]);
export const feedbackDay = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export const feedbackScore = z.enum(["atmosphere", "comfort", "organization"]);
export const communicationLocale = z.enum(["ru", "uk"]);

export type NotificationCategory = z.infer<typeof notificationCategory>;

const revision = z.number().int().nonnegative();
export const notificationPreferences = z.object({
  categories: z.array(notificationCategory).max(5),
  locale: communicationLocale,
  revision,
});
const score = z.number().int().min(1).max(5).nullable();
export const feedback = z.object({
  atmosphere: score,
  comfort: score,
  organization: score,
  reasons: z.array(feedbackReason).max(5),
  days: z.array(feedbackDay).max(7),
  suggestion: z.string().max(600).nullable(),
  revision,
});
export const memberPreferences = z.object({
  notifications: notificationPreferences.nullable(),
  feedback: feedback.nullable(),
});
export type Feedback = z.infer<typeof feedback>;
export type NotificationPreferences = z.infer<typeof notificationPreferences>;

const count = z.number().int().nonnegative();
export const notificationPreview = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable") }),
  z.object({ status: z.literal("stale") }),
  z.object({
    status: z.literal("ready"),
    key: z.string().regex(/^[0-9a-f]{32}$/),
    starts_at: z.string(),
    place: z.string(),
    evening_status: z.enum(["planned", "finished", "cancelled"]),
    capacity: z.union([z.literal(9), z.literal(10)]),
    games: count,
    candidate: count,
    duplicates: count,
    limited: count,
    ru: count,
    uk: count,
    recorded: count,
  }),
]);
type Preview = Extract<z.infer<typeof notificationPreview>, { status: "ready" }>;
export const notificationLog = z.array(z.object({
  category: notificationCategory, simulated_at: z.string(), starts_at: z.string(), place: z.string(), recipients: count,
}));

export const feedbackSummary = z.object({
  scores: z.array(z.object({ key: feedbackScore, responses: count, average: z.number() })),
  reasons: z.array(z.object({ key: feedbackReason, responses: count })),
  days: z.array(z.object({ key: feedbackDay, responses: count })),
  suggestions: z.array(z.string()),
});

const messageTitles: Record<Locale, Record<NotificationCategory | "cancelled", string>> = {
  ru: {
    announcement: "Назначен новый игровой вечер",
    reminder: "Напоминание о вашей записи",
    ready: "Состав на игровой вечер набран",
    change: "Условия игрового вечера изменились",
    cancelled: "Игровой вечер отменён",
    recap: "Итоги игрового вечера",
  },
  uk: {
    announcement: "Призначено новий ігровий вечір",
    reminder: "Нагадування про ваш запис",
    ready: "Склад на ігровий вечір зібрано",
    change: "Умови ігрового вечора змінилися",
    cancelled: "Ігровий вечір скасовано",
    recap: "Підсумки ігрового вечора",
  },
};

export type TelegramDraft = { locale: Locale; audienceSize: number; text: string };

export interface TelegramSimulation {
  simulate(draft: TelegramDraft): TelegramDraft & { status: "simulated" };
}

const dryRunTelegram: TelegramSimulation = {
  simulate: (draft) => ({ ...draft, status: "simulated" }),
};

export function telegramDraft(category: NotificationCategory, preview: Preview, locale: Locale): TelegramDraft {
  const cancelled = category === "change" && preview.evening_status === "cancelled";
  const title = messageTitles[locale][cancelled ? "cancelled" : category];
  const date = fullDateTime(preview.starts_at, locale);
  const format = preview.capacity === 9
    ? (locale === "uk" ? "Дев’ятка" : "Девятка")
    : (locale === "uk" ? "Класика" : "Классика");
  const details = category === "recap"
    ? (locale === "uk" ? `Завершені партії · ${preview.games}` : `Завершённые партии · ${preview.games}`)
    : format;
  return {
    locale, audienceSize: preview[locale],
    text: `Mafia League · ${title}\n${date} (Europe/Vienna)\n${preview.place}\n${details}`,
  };
}

/** The port accepts counts and plain text only. It cannot address a real chat. */
export function simulateTelegram(
  category: NotificationCategory,
  preview: Preview,
  provider: TelegramSimulation = dryRunTelegram,
) {
  return communicationLocale.options.filter((locale) => preview[locale] > 0)
    .map((locale) => provider.simulate(telegramDraft(category, preview, locale)));
}
