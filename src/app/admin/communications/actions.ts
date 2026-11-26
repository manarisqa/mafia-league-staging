"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { notificationCategory, notificationPreview, simulateTelegram, telegramDraft, type NotificationCategory, type TelegramDraft } from "@/lib/club/communications";
import type { CommunicationLabel } from "@/lib/i18n/communications";

export type PreviewState = {
  label?: CommunicationLabel;
  recorded?: number;
  preview?: {
    evening: string;
    category: NotificationCategory;
    key: string;
    counts: { candidates: number; duplicates: number; limited: number; recipients: number };
    messages: TelegramDraft[];
  };
};

const input = z.object({
  evening: z.guid(),
  category: notificationCategory,
  key: z.string().regex(/^[0-9a-f]{32}$/).nullable(),
});

export async function previewNotification(_prev: PreviewState, form: FormData): Promise<PreviewState> {
  const { supabase } = await requireAdmin();
  const parsed = input.safeParse({ evening: form.get("evening"), category: form.get("category"), key: form.get("key") });
  if (!parsed.success) return { label: "invalid" };
  const { evening, category, key } = parsed.data;
  const { data, error } = await supabase.rpc("club_notification_preview", {
    p_evening: evening, p_category: category, p_record_key: key,
  });
  if (error) return { label: "failed" };
  const result = notificationPreview.safeParse(data);
  if (!result.success) return { label: "failed" };
  if (result.data.status !== "ready") return { label: result.data.status };
  if (key !== null) {
    revalidatePath("/admin/communications");
    return { recorded: result.data.recorded };
  }
  const drafts = simulateTelegram(category, result.data);
  return {
    preview: {
      evening, category, key: result.data.key,
      counts: {
        candidates: result.data.candidate, duplicates: result.data.duplicates,
        limited: result.data.limited, recipients: result.data.ru + result.data.uk,
      },
      messages: drafts.length > 0 ? drafts : [telegramDraft(category, result.data, await getLocale())],
    },
  };
}
