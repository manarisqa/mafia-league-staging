import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Обновляет сессию входа и быстро отправляет гостей с /admin на /login.
// Это лишь первая проверка: настоящая защита — requireAdmin() в самих страницах и действиях.
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/referee" && request.headers.get("x-mafia-referee-shell") === "1") {
    for (const { name } of request.cookies.getAll()) {
      if (/^sb-.*-auth-token(?:\.\d+)?$/.test(name)) request.cookies.delete(name);
    }
    const shell = NextResponse.next({ request });
    shell.headers.set("X-Mafia-Referee-Shell", "1");
    return shell;
  }
  if (request.nextUrl.pathname.startsWith("/api/referee/")) return NextResponse.next({ request });
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();

  if (!data?.claims && request.nextUrl.pathname.startsWith("/admin")) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    return NextResponse.redirect(login);
  }

  return response;
}

// Сессия обновляется на всех страницах (кроме файлов), чтобы кнопки входа и запись на вечер
// не «разлогинивали» человека после истечения короткого токена.
export const config = {
  matcher: ["/((?!_next/static|_next/image|icon\\.svg|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
