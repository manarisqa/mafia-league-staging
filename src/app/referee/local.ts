import { checksum, importProtocol } from "@/lib/referee/engine";
import { validate } from "@/lib/referee/guided/reducer";
import type { Draft } from "@/lib/referee/guided/protocol";

const prefix = "mafia.guided.";
export const activeKey = prefix + "active";
export const catalogKey = prefix + "catalog";
const draftKey = (id: string) => prefix + "draft." + id;
export const clockKey = (id: string) => prefix + "clock." + id;
export const isDraftChange = (key: string | null) => key === null || key.startsWith(prefix + "draft.");

export type Status = "draft" | "submitted" | "clarify" | "approved" | "rejected" | "archived" | "revoked";
type Cancellation = {
  id: string; secret: string; startedAt: string; replacement: string; at: string;
  state: "pending" | "cancelled" | "protected";
};
export type LocalDraft = {
  draft: Draft; secret: string; serial: number; revision: number; status: Status; synced: number;
  outbox: boolean; note: string | null;
  slot?: string; cancellations?: Cancellation[]; discarded?: string[]; fromFile?: boolean;
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
  return read<LocalDraft>(draftKey(id)) ?? list().find((record) => record.draft.id === id) ?? null;
}

export const slotOf = (record: LocalDraft) => record.slot ?? record.draft.id;
export const wasCancelled = (id: string) => list().some((record) =>
  record.cancellations?.some((entry) => entry.id === id) || record.discarded?.includes(id));

export function newLocal(draft: Draft): LocalDraft {
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, "0")).join("");
  return { draft, secret, serial: 0, revision: 0, status: "draft", synced: -1, outbox: false, note: null };
}

export async function write(next: LocalDraft, expected: number | null, activate = false) {
  const slot = slotOf(next);
  const put = () => {
    const current = read<LocalDraft>(draftKey(slot));
    if ((current?.serial ?? null) !== expected) throw new Error("localConflict");
    if (expected === null && wasCancelled(next.draft.id)) throw new Error("conflict");
    const saved = { ...next, serial: (current?.serial ?? 0) + 1 };
    save(draftKey(slot), saved);
    if (activate) save(activeKey, slot);
    return saved;
  };
  return navigator.locks ? navigator.locks.request(prefix + "write", put) : put();
}

export async function withCloudLock<T>(record: LocalDraft, task: (latest: LocalDraft) => Promise<T>) {
  const slot = slotOf(record);
  const run = () => {
    const latest = get(slot);
    if (!latest || latest.serial !== record.serial) throw new Error("localConflict");
    return task(latest);
  };
  return navigator.locks ? navigator.locks.request(prefix + "cloud." + slot, run) : run();
}

export function restartLocal(record: LocalDraft): LocalDraft {
  if (record.status !== "draft" || record.cancellations?.some((entry) => entry.state === "protected")) {
    throw new Error("restartProtected");
  }
  const at = new Date().toISOString();
  const next = newLocal({ ...record.draft, id: crypto.randomUUID(), startedAt: at, events: [] });
  return {
    ...next, slot: slotOf(record), discarded: record.discarded, fromFile: record.fromFile,
    cancellations: [...(record.cancellations ?? []), {
      id: record.draft.id, secret: record.secret, at, startedAt: record.draft.startedAt,
      replacement: next.draft.id, state: "pending",
    }],
  };
}

export function clearClocks(id: string) {
  const key = clockKey(id) + ".";
  for (const entry of Object.keys(localStorage)) if (entry.startsWith(key)) localStorage.removeItem(entry);
}

export async function cloud(action: "read" | "save" | "submit" | "revoke" | "restart", current: LocalDraft, cancellation?: Cancellation) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("/api/referee/draft", {
      method: "POST", headers: { "Content-Type": "application/json" },
      cache: "no-store", credentials: "same-origin",
      signal: controller.signal,
      body: JSON.stringify({
        id: cancellation?.id ?? current.draft.id, secret: cancellation?.secret ?? current.secret,
        revision: cancellation ? 0 : current.revision, action,
        ...(action === "save" || action === "submit" ? { payload: current.draft } : {}),
        ...(action === "restart" && cancellation ? { payload: {
          attempt: { ...current.draft, id: cancellation.id, startedAt: cancellation.startedAt, events: [] },
          replacement: cancellation.replacement,
        } } : {}),
      }),
    });
    return await response.json() as { revision: number; status: Status; note?: string; payload?: Draft; error?: string };
  } finally { clearTimeout(timeout); }
}

// Only cancellation receipts are retried automatically. Sending a result is a separate user action.
export async function reconcileRestarts(record: LocalDraft, persist: (value: LocalDraft, serial: number) => Promise<LocalDraft>) {
  let working = record;
  for (const entry of record.cancellations ?? []) {
    if (entry.state === "protected") throw new Error("restartProtected");
    if (entry.state !== "pending") continue;
    const result = await cloud("restart", working, entry);
    if (result.error && result.error !== "restart_protected") throw new Error(result.error);
    if (!result.error && result.status !== "revoked") throw new Error("unavailable");
    const state = result.error ? "protected" : "cancelled";
    working = await persist({
      ...working, outbox: state === "protected" ? false : working.outbox,
      cancellations: working.cancellations?.map((prior) => prior.id === entry.id ? { ...prior, state } : prior),
    }, working.serial);
    if (state === "protected") throw new Error("restartProtected");
  }
  return working;
}

export async function recoverProtected(record: LocalDraft): Promise<LocalDraft> {
  const entries = record.cancellations ?? [];
  const index = entries.findIndex((entry) => entry.state === "protected");
  const original = entries[index];
  if (!original) throw new Error("invalid");
  const result = await cloud("read", record, original);
  if (result.error || !result.payload || result.status === "draft") throw new Error(result.error ?? "invalid");
  const draft = validate(result.payload).draft;
  return {
    ...record, draft, secret: original.secret, status: result.status, synced: draft.events.length,
    revision: result.revision, note: result.note ?? null, outbox: false, cancellations: entries.slice(0, index),
    discarded: [...(record.discarded ?? []), ...entries.slice(index + 1).map((entry) => entry.id), record.draft.id],
  };
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

export function mergeRecoveredDraft(stored: LocalDraft | null, remote: LocalDraft): LocalDraft {
  if (!stored) return remote;
  const pendingSubmission = stored.outbox && ["draft", "clarify"].includes(remote.status);
  if (stored.draft.id !== remote.draft.id || stored.synced !== stored.draft.events.length ||
    remote.revision < stored.revision || (pendingSubmission && remote.revision !== stored.revision)) {
    throw new Error("conflict");
  }
  // A copy read before a queued submission was accepted cannot acknowledge it.
  return { ...stored, ...remote, outbox: pendingSubmission };
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
