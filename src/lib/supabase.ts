import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Клиент для публичного чтения данных клуба (без входа в аккаунт).
 * Что можно видеть и менять, решают правила доступа (RLS) в самой базе.
 *
 * Возвращает null, если ключи Supabase не заданы — тогда страницы
 * показывают демонстрационные данные из `lib/demo.ts`.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function hasSupabaseConfig() {
  return !!url && !!key;
}

export function getPublicClient(): SupabaseClient | null {
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
