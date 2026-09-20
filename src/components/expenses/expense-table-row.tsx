import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { ExpenseActions } from "@/components/expenses/expense-actions";
import type { ExpenseCardProps } from "@/components/expenses/expense-mobile-card";
import { formatIsoDateDmy, formatMoney } from "@/lib/format";

export function ExpenseTableRow({
  expense: e,
  associations,
  isEditing,
  draft,
  onChange,
  onEdit,
  onCancel,
  onSave,
  saving,
  onOpenFile,
  onDelete,
  details,
}: ExpenseCardProps) {
  const associationName = e.association_id
    ? (associations.find((a) => a.id === e.association_id)?.name ?? "—")
    : "—";

  const deleteDescription = `This will permanently remove ${e.supplier ?? "this expense"}${e.file_path ? " and its attached receipt file" : ""}. This can't be undone.`;

  const actions = (
    <ExpenseActions
      isEditing={isEditing}
      saving={saving}
      filePath={e.file_path}
      deleteDescription={deleteDescription}
      onEdit={onEdit}
      onCancel={onCancel}
      onSave={onSave}
      onOpenFile={onOpenFile}
      onDelete={onDelete}
    />
  );

  if (!isEditing) {
    return (
      <TableRow>
        <TableCell className="whitespace-nowrap">
          {e.expense_date ? formatIsoDateDmy(e.expense_date) : "—"}
        </TableCell>
        <TableCell className="font-medium">{e.supplier ?? "—"}</TableCell>
        <TableCell className="whitespace-nowrap">{formatMoney(e.amount, e.currency)}</TableCell>
        <TableCell>{e.category ?? "—"}</TableCell>
        <TableCell className="max-w-48 truncate" title={e.reference_number ?? ""}>
          {e.reference_number ?? "—"}
        </TableCell>
        <TableCell>{associationName}</TableCell>
        <TableCell>{details}</TableCell>
        <TableCell>{actions}</TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell>
        <Input
          type="date"
          value={draft.expense_date ?? ""}
          onChange={(ev) => onChange({ expense_date: ev.target.value || null })}
          className="w-28"
        />
      </TableCell>
      <TableCell>
        <Input
          value={draft.supplier ?? ""}
          onChange={(ev) => onChange({ supplier: ev.target.value || null })}
          className="min-w-28"
        />
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Input
            type="number"
            step="0.01"
            value={draft.amount ?? ""}
            onChange={(ev) =>
              onChange({ amount: ev.target.value ? Number(ev.target.value) : null })
            }
            className="w-20"
          />
          <Input
            value={draft.currency ?? ""}
            onChange={(ev) => onChange({ currency: ev.target.value || null })}
            className="w-14"
            placeholder="EUR"
          />
        </div>
      </TableCell>
      <TableCell>
        <Input
          value={draft.category ?? ""}
          onChange={(ev) => onChange({ category: ev.target.value || null })}
          className="min-w-20"
        />
      </TableCell>
      <TableCell>
        <Input
          value={draft.reference_number ?? ""}
          onChange={(ev) => onChange({ reference_number: ev.target.value || null })}
          className="min-w-20"
          placeholder="Invoice #"
        />
      </TableCell>
      <TableCell>
        <Select
          value={draft.association_id ?? "none"}
          onValueChange={(v) => onChange({ association_id: v === "none" ? null : v })}
        >
          <SelectTrigger className="min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— unassigned —</SelectItem>
            {associations.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>{details}</TableCell>
      <TableCell>{actions}</TableCell>
    </TableRow>
  );
}
