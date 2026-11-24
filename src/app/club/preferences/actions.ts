"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { feedback, notificationPreferences } from "@/lib/club/communications";
import type { CommunicationLabel } from "@/lib/i18n/communications";

export type PreferenceState = { label?: CommunicationLabel; ok?: boolean };

async function getMemberDatabase() {
  const db = await createServerSupabase();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect("/login");
  return db;
}

function formRevision(form: FormData) {
  const value = form.get("revision");
  return typeof value === "string" && /^\d{1,10}$/.test(value) ? Number(value) : null;
}

function score(form: FormData, field: string) {
  const value = form.get(field);
  return value === "" ? null : typeof value === "string" && /^[1-5]$/.test(value) ? Number(value) : undefined;
}

export async function saveNotifications(_prev: PreferenceState, form: FormData): Promise<PreferenceState> {
  const db = await getMemberDatabase();
  const parsed = notificationPreferences.safeParse({
    categories: form.getAll("category"),
    locale: form.get("locale"),
    revision: formRevision(form),
  });
  if (!parsed.success) return { label: "invalid" };
  const { data, error } = await db.rpc("save_club_notification_preferences", {
    p_categories: parsed.data.categories, p_locale: parsed.data.locale, p_revision: parsed.data.revision,
  });
  if (error) return { label: "failed" };
  if (data === "conflict") return { label: "conflict" };
  revalidatePath("/club/preferences");
  return { ok: true, label: "savedPreferences" };
}

const feedbackInput = feedback.extend({ suggestion: z.string().trim().max(600) });

export async function saveFeedback(_prev: PreferenceState, form: FormData): Promise<PreferenceState> {
  const db = await getMemberDatabase();
  const remove = form.get("mode") === "remove";
  const parsed = feedbackInput.safeParse({
    atmosphere: remove ? null : score(form, "atmosphere"),
    comfort: remove ? null : score(form, "comfort"),
    organization: remove ? null : score(form, "organization"),
    reasons: remove ? [] : form.getAll("reason"),
    days: remove ? [] : form.getAll("day"),
    suggestion: remove ? "" : form.get("suggestion"),
    revision: formRevision(form),
  });
  if (!parsed.success) return { label: "invalid" };
  const { atmosphere, comfort, organization, reasons, days, suggestion, revision } = parsed.data;
  const { data, error } = await db.rpc("save_club_feedback", {
    p_atmosphere: atmosphere, p_comfort: comfort, p_organization: organization,
    p_reasons: reasons, p_days: days, p_suggestion: suggestion || null, p_revision: revision,
  });
  if (error) return { label: "failed" };
  if (data === "conflict") return { label: "conflict" };
  revalidatePath("/club/preferences");
  return { ok: true, label: remove ? "removedFeedback" : "savedFeedback" };
}
