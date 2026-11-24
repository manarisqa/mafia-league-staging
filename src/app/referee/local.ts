import { checksum, importProtocol } from "@/lib/referee/engine";
import { validate } from "@/lib/referee/guided/reducer";
import type { Draft } from "@/lib/referee/guided/protocol";

const prefix = "mafia.guided.";
export const activeKey = prefix + "active";
export const catalogKey = prefix + "catalog";
const draftKey = (id: string) => prefix + "draft." + id;
export const clockKey = (id: string) => prefix + "clock." + id;

export type Status = "draft" | "submitted" | "clarify" | "approved" | "rejected" | "archived" | "revoked";
export type LocalDraft = {
  draft: Draft; secret: string; serial: number; revision: number; status: Status; synced: number;
  outbox: boolean; note: string | null;
};

export function read<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") as T | null; }
  catch { return null; }
}

export function save<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function list() {
  return Object.keys(localStorage).filter((key) => key.startsWith(prefix + "draft."))
    .flatMap((key) => {
      const data = read<LocalDraft>(key);
      return data ? [data] : [];
    })
    .sort((a, b) => b.draft.startedAt.localeCompare(a.draft.startedAt));
}

export function get(id: string) {
  return read<LocalDraft>(draftKey(id));
}

export function newLocal(draft: Draft): LocalDraft {
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, "0")).join("");
  return { draft, secret, serial: 0, revision: 0, status: "draft", synced: -1, outbox: false, note: null };
}

export async function write(next: LocalDraft, expected: number | null, activate = false) {
  const put = () => {
    const current = get(next.draft.id);
    if ((current?.serial ?? null) !== expected) throw new Error("localConflict");
    const saved = { ...next, serial: (current?.serial ?? 0) + 1 };
    save(draftKey(next.draft.id), saved);
    if (activate) save(activeKey, next.draft.id);
    return saved;
  };
  return navigator.locks ? navigator.locks.request(draftKey(next.draft.id), put) : put();
}

export async function cloud(action: "read" | "save" | "submit" | "revoke", current: LocalDraft) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("/api/referee/draft", {
      method: "POST", headers: { "Content-Type": "application/json" },
      cache: "no-store", credentials: "same-origin",
      signal: controller.signal,
      body: JSON.stringify({
        id: current.draft.id, secret: current.secret, revision: current.revision, action,
        ...(action === "save" || action === "submit" ? { payload: current.draft } : {}),
      }),
    });
    return await response.json() as { revision: number; status: Status; note?: string; payload?: Draft; error?: string };
  } finally { clearTimeout(timeout); }
}

export async function restoreWithCode(code: string) {
  const match = /^([0-9a-f-]{36})\.([0-9a-f]{64})$/i.exec(code.trim());
  if (!match) throw new Error("invalid");
  const remote = await cloud("read", {
    draft: { id: match[1] } as Draft, secret: match[2].toLowerCase(),
    revision: 0, serial: 0, status: "draft", synced: -1, outbox: false, note: null,
  });
  if (remote.error || !remote.payload) throw new Error(remote.error ?? "invalid");
  const { draft } = validate(remote.payload);
  return {
    ...newLocal(draft), secret: match[2].toLowerCase(), revision: remote.revision, status: remote.status,
    synced: draft.events.length, note: remote.note ?? null,
  };
}

export async function download(draft: Draft) {
  const blob = new Blob([JSON.stringify({ payload: draft, sha256: await checksum(draft) }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "mafia-protocol-" + draft.id + ".json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importFile(file: File) {
  if (file.size > 2_000_000) throw new Error("invalid");
  const text = await file.text();
  const envelope = JSON.parse(text);
  if (envelope?.payload?.schema) return { legacy: await importProtocol(text) };
  if (await checksum(envelope.payload) !== envelope.sha256) throw new Error("invalid");
  return { draft: validate(envelope.payload).draft };
}
