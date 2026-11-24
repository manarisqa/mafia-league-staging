import type { Metadata } from "next";
import { Suspense } from "react";
import { getLocale } from "@/lib/i18n/server";
import { seasonText } from "@/lib/i18n/seasons";
import { SeasonReport } from "./season-report";

export async function generateMetadata(): Promise<Metadata> {
  return { title: seasonText(await getLocale()).title };
}

export default function SeasonsPage({ searchParams }: PageProps<"/history/seasons">) {
  return <Suspense><SeasonReport searchParams={searchParams} /></Suspense>;
}
