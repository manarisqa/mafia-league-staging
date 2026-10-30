"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { createServerSupabase } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import { isValidNickname, normalizeNickname } from "@/lib/nickname";

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const locale = await getLocale();
  const t = (key: MessageKey) => translate(locale, key);
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { message: t("credentialsRequired") };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // Одно и то же сообщение для любой ошибки, чтобы не раскрывать, какие почты есть в системе.
  if (error) return { message: t("credentialsInvalid") };

  const { data: isAdmin } = await supabase.rpc("is_admin");
  redirect(isAdmin === true ? "/admin" : "/evenings");
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const locale = await getLocale();
  const t = (key: MessageKey) => translate(locale, key);
  const nickname = normalizeNickname(String(formData.get("nickname") ?? ""));
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!isValidNickname(nickname)) return { message: t("nicknameInvalid") };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { message: t("emailInvalid") };
  if (password.length < 8) return { message: t("passwordShort") };
  if (password.length > 72) return { message: t("passwordLong") };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { nickname, display_name: nickname } },
  });

  if (error) {
    if (/already registered/i.test(error.message)) {
      return { message: t("emailRegistered") };
    }
    if (/password/i.test(error.message)) {
      return { message: t("passwordWeak") };
    }
    return { message: t("registrationFailed") };
  }

  // Если в Supabase всё ещё включено подтверждение почты, сессии не будет.
  if (!data.session) {
    return { message: t("confirmEmail") };
  }

  redirect("/evenings");
}

export async function signOut() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/");
}
