import type { FormState } from "@/lib/form-state";

export function expectedRevision(form: FormData): number | null {
  const raw = form.get("revision");
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function mutationError(error: { code?: string; message: string }): FormState {
  return {
    ok: false,
    message: error.code === "40P01" ? "Одновременное изменение данных. Повторите действие; ничего не потеряно." : error.code === "P0001" || error.code === "40001"
      ? error.message
      : "Не удалось сохранить. Проверьте данные и повторите.",
  };
}
