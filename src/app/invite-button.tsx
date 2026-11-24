"use client";

import { useState } from "react";
import { useTranslation } from "@/components/locale-provider";
import { siteText } from "@/lib/i18n/site";

export function InviteButton() {
  const { locale } = useTranslation();
  const [copied, setCopied] = useState(false);
  return <button type="button" className="min-h-11 rounded-control border border-border px-4 hover:border-accent-text"
    onClick={async () => {
      const url = new URL("/evenings", window.location.origin).href;
      if (navigator.share) {
        await navigator.share({ url }).catch(() => undefined);
      } else {
        await navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(() => undefined);
      }
    }}>{siteText(locale, copied ? "Ссылка скопирована" : "Пригласить друга")}</button>;
}
