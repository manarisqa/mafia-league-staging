"use client";

import { useState } from "react";
import { useTranslation } from "@/components/locale-provider";
import { siteText } from "@/lib/i18n/site";

export function InviteButton({ path = "/evenings" }: { path?: string }) {
  const { locale } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const t = (label: string) => siteText(locale, label);
  return (
    <div>
      <button type="button" className="min-h-11 rounded-control border border-border px-4 hover:border-accent-text"
        onClick={async () => {
          const url = new URL(path, window.location.origin).href;
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          } catch {
            setManualUrl(url);
          }
        }}>{t("Пригласить друга")}</button>
      {copied && <p role="status" className="mt-2 text-sm text-success">{t("Ссылка скопирована")}</p>}
      {manualUrl && (
        <label className="mt-2 block text-sm text-muted">
          {t("Скопируйте ссылку")}
          <input readOnly value={manualUrl} onFocus={(e) => e.currentTarget.select()}
            className="mt-1 block min-h-11 w-full rounded-control border border-border bg-elevated px-3 text-text" />
        </label>
      )}
    </div>
  );
}
