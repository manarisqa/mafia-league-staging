import Link from "next/link";
import { Suspense } from "react";
import { getLocale } from "@/lib/i18n/server";
import { siteText } from "@/lib/i18n/site";
import { createServerSupabase } from "@/lib/supabase/server";
import { GuidedReferee } from "./guided-referee";
import "./referee.css";

export default function RefereePage() {
  return <GuidedReferee adminEvenings={<Suspense><AdminEvenings /></Suspense>} />;
}

async function AdminEvenings() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return null;
  const db = await createServerSupabase();
  const { data } = await db.auth.getClaims();
  if (!data?.claims) return null;
  const { data: admin } = await db.rpc("is_admin");
  return admin === true
    ? <Link href="/admin/evenings" className="ref-link">{siteText(await getLocale(), "Новый вечер")}</Link>
    : null;
}
