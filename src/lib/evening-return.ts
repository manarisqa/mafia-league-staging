import { isUuid } from "@/lib/validate";

export function eveningReturn(value: unknown) {
  const prefix = "/evenings/";
  if (typeof value !== "string" || !value.startsWith(prefix)) return undefined;
  const id = value.slice(prefix.length);
  return isUuid(id) ? prefix + id.toLowerCase() : undefined;
}

export function eveningAuthLink(path: "/login" | "/register", next?: string) {
  return next ? path + "?" + new URLSearchParams({ next }) : path;
}
