"use client";
import { useState } from "react";
import type { FormState } from "@/lib/form-state";

/** Keep the version of the editable fields. Fresh server props cannot silently
 * authorize overwriting a stale editor; only its own successful save advances. */
export function RevisionField({ initial, state }: { initial: number; state: FormState }) {
  const [saved, setSaved] = useState({ revision: initial, response: state });
  if (state !== saved.response && state.ok && state.revision !== undefined) {
    setSaved({ revision: state.revision, response: state });
  }
  return <input type="hidden" name="revision" value={saved.revision} />;
}
