import { Text } from "@/components/locale-provider";
import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { createServerSupabase } from "@/lib/supabase/server";

const bar = {
  link: "inline-flex h-11 items-center rounded-control px-4 text-sm text-muted transition-colors hover:text-text",
  primary:
    "inline-flex h-11 items-center rounded-control bg-accent px-5 text-sm font-medium transition-colors hover:bg-accent-hover",
  ghost:
    "inline-flex h-11 items-center rounded-control border border-border px-4 text-sm transition-colors hover:border-accent-text",
};
const menu = {
  link: "flex min-h-12 items-center border-l-2 border-transparent px-4 text-base text-muted hover:text-text",
  primary: "flex h-12 items-center justify-center rounded-control bg-accent font-medium hover:bg-accent-hover",
  ghost: "flex h-12 w-full items-center justify-center rounded-control border border-border hover:border-accent-text",
};

/** Кнопки входа/выхода. Читает сессию, поэтому используется внутри Suspense. */
export async function AuthButton({ variant }: { variant: "bar" | "menu" }) {
  const s = variant === "bar" ? bar : menu;
  const wrap = variant === "bar" ? "hidden items-center gap-2 sm:flex" : "flex flex-col gap-2 py-3";

  let signedIn = false;
  let isAdmin = false;
  let playerId: string | null = null;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    try {
      const supabase = await createServerSupabase();
      const { data } = await supabase.auth.getClaims();
      signedIn = !!data?.claims;
      if (signedIn) {
        const [{ data: admin }, { data: player }] = await Promise.all([
          supabase.rpc("is_admin"),
          supabase.from("players").select("id").eq("user_id", data!.claims.sub).maybeSingle(),
        ]);
        isAdmin = admin === true;
        playerId = player?.id ?? null;
      }
    } catch {
      signedIn = false;
    }
  }

  if (!signedIn) {
    return <AuthLinks variant={variant} wrap={wrap} s={s} />;
  }
  return (
    <div className={wrap}>
      {/* Пока профиль — это публичная страница игрока. */}
      {playerId && (
        <Link href={`/players/${playerId}`} className={s.ghost}>
          <Text id="profile" />
        </Link>
      )}
      {isAdmin && (
        <Link href="/admin" className={s.link}>
          <Text id="admin" />
        </Link>
      )}
      <form action={signOut} className={variant === "menu" ? "w-full" : undefined}>
        <button type="submit" className={s.ghost}>
          <Text id="signOut" />
        </button>
      </form>
    </div>
  );
}

/** То, что видит гость (и пока грузится проверка входа). */
export function AuthLinks({
  variant,
  wrap,
  s,
}: {
  variant: "bar" | "menu";
  wrap?: string;
  s?: typeof bar;
}) {
  const st = s ?? (variant === "bar" ? bar : menu);
  const w = wrap ?? (variant === "bar" ? "hidden items-center gap-2 sm:flex" : "flex flex-col gap-2 py-3");
  return (
    <div className={w}>
      <Link href="/register" className={st.link}>
        <Text id="register" />
      </Link>
      <Link href="/login" className={st.primary}>
        <Text id="signIn" />
      </Link>
    </div>
  );
}
