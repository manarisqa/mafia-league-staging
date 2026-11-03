import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { RefereeWorkbench } from "./workbench";

export const metadata: Metadata = { title: "Пульт ведущего · Админка", robots: { index: false } };

export default async function RefereePage() {
  await requireAdmin();
  return <RefereeWorkbench />;
}
