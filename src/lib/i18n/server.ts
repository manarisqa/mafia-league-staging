import "server-only";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale } from "./messages";

export async function getLocale() {
  return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}
