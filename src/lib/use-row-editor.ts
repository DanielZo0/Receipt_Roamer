import { useState } from "react";

/**
 * Single-row "switch on editing" state for a list.
 *
 * At most one row is editable at a time. `start` seeds a draft from just the
 * fields you name, so saving sends a patch containing nothing else — which
 * keeps the callers' diff-based mutations (expense_corrections, rule prompts)
 * working unchanged.
 */
export function useRowEditor<T extends { id: string }>() {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<T>>({});

  function start(row: T, fields: readonly (keyof T)[]) {
    const seed: Partial<T> = {};
    for (const f of fields) seed[f] = row[f];
    setDraft(seed);
    setEditingId(row.id);
  }

  function cancel() {
    setEditingId(null);
    setDraft({});
  }

  return {
    editingId,
    draft,
    isEditing: (id: string) => editingId === id,
    start,
    set: (patch: Partial<T>) => setDraft((d) => ({ ...d, ...patch })),
    cancel,
  };
}

export type RowEditor<T extends { id: string }> = ReturnType<typeof useRowEditor<T>>;

/** True when every field in `draft` already matches `row` — lets callers skip a no-op write. */
export function draftIsUnchanged<T extends { id: string }>(row: T, draft: Partial<T>): boolean {
  return (Object.keys(draft) as (keyof T)[]).every((k) => draft[k] === row[k]);
}
