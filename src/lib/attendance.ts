import "server-only";
import { z } from "zod";
import { hasSupabaseConfig } from "@/lib/supabase";
import { createServerSupabase } from "@/lib/supabase/server";

export const ATTENDANCE_PAGE_SIZE = 12;
const attendanceRows = z.array(z.object({ id: z.string(), startsAt: z.string(), place: z.string() }));

export async function getOwnAttendance(playerId: string, page = 1, startDay?: string, endDay?: string) {
  if (!hasSupabaseConfig()) return null;
  const db = await createServerSupabase();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) return null;
  const { data: player } = await db.from("players").select("id")
    .eq("id", playerId).eq("user_id", claims.claims.sub).maybeSingle();
  if (!player) return null;

  const result = await db.rpc("my_evening_attendance", {
    p_player: playerId, p_offset: (page - 1) * ATTENDANCE_PAGE_SIZE,
    p_start_day: startDay, p_end_day: endDay,
  });
  const rows = attendanceRows.safeParse(result.data);
  if (result.error || !rows.success) return { state: "unavailable" } as const;
  return { state: "available", rows: rows.data } as const;
}
