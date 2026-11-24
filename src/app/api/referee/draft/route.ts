import { z } from "zod";
import { getPublicClient } from "@/lib/supabase";
import { validate } from "@/lib/referee/guided/reducer";

const maxBytes = 480_000;
const input = z.object({
  id: z.string().uuid(),
  secret: z.string().regex(/^[0-9a-f]{64}$/),
  revision: z.number().int().min(0).max(2147483647),
  action: z.enum(["read", "save", "submit", "revoke"]),
  payload: z.unknown().optional(),
}).strict();

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function boundedJson(request: Request) {
  if (!request.body || Number(request.headers.get("content-length")) > maxBytes) throw new Error("size");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0, text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error("size");
    }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site" ||
    request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return reply({ error: "denied" }, 403);
  }
  let parsed: z.infer<typeof input>;
  let payload = null;
  try {
    parsed = input.parse(await boundedJson(request));
    if (parsed.action === "save" || parsed.action === "submit") {
      const data = validate(parsed.payload);
      if (data.draft.id !== parsed.id || (parsed.action === "submit" && !data.state.result)) {
        return reply({ error: "invalid" }, 422);
      }
      payload = data.draft;
    } else if (parsed.payload !== undefined) {
      return reply({ error: "invalid" }, 422);
    }
  } catch {
    return reply({ error: "invalid" }, 422);
  }

  const db = getPublicClient();
  const result = await db?.rpc("guided_guest", {
    p_action: parsed.action, p_id: parsed.id, p_secret: parsed.secret,
    p_revision: parsed.revision, p_payload: payload,
  });
  if (!result || result.error) return reply({ error: "unavailable" }, 503);
  const errors: Record<string, number> = { denied: 403, conflict: 409, round: 409, rate: 429, invalid: 422 };
  return reply(result.data, errors[result.data?.error] ?? 200);
}
