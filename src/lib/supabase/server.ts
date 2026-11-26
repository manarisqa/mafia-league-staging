import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

/**
 * Клиент Supabase от имени вошедшего пользователя (читает сессию из cookie).
 * Все запросы идут с его правами, поэтому защитой остаётся RLS в базе.
 * Никогда не передавайте его в функции с "use cache": данные администратора
 * попали бы в общий кэш и стали видны всем посетителям.
 */
export async function createServerSupabase() {
  await connection();
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Вызов из серверного компонента: cookie обновляет proxy.ts.
          }
        },
      },
    },
  );
}
