"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, LOCALES, type Locale } from "./messages";

export async function setLocale(formData: FormData) {
  const locale = formData.get("locale");
  if (!LOCALES.includes(locale as Locale)) return;
  (await cookies()).set(LOCALE_COOKIE, String(locale), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
