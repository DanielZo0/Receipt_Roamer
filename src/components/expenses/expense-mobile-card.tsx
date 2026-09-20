import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MobileCard,
  MobileCardHeader,
  MobileCardLabel,
  MobileCardRow,
} from "@/components/ui/responsive-table";
import { ExpenseActions } from "@/components/expenses/expense-actions";
import type { AssociationLite, ExpenseRow } from "@/lib/expense-types";
import { formatIsoDateDmy, formatMoney } from "@/lib/format";

export type ExpenseCardProps = {
  expense: ExpenseRow;
  associations: AssociationLite[];
  isEditing: boolean;
  draft: Partial<ExpenseRow>;
  onChange: (patch: Partial<ExpenseRow>) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  onOpenFile: () => void;
  onDelete: () => void;
  details: ReactNode;
};

export function ExpenseMobileCard({
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
      <MobileCard>
        <MobileCardHeader>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {e.expense_date ? formatIsoDateDmy(e.expense_date) : "—"}
          </span>
          <span className="font-semibold whitespace-nowrap">
            {formatMoney(e.amount, e.currency)}
          </span>
        </MobileCardHeader>

        <p className="font-medium truncate" title={e.supplier ?? ""}>
          {e.supplier ?? "—"}
        </p>

        {e.reference_number && (
          <p className="text-xs text-muted-foreground truncate" title={e.reference_number}>
            {e.reference_number}
          </p>
        )}

        <MobileCardRow>
          <MobileCardLabel>Category</MobileCardLabel>
          <span className="min-w-0 truncate">{e.category ?? "—"}</span>
        </MobileCardRow>

        <MobileCardRow>
          <MobileCardLabel>Association</MobileCardLabel>
          <span className="min-w-0 truncate">{associationName}</span>
        </MobileCardRow>

        <div className="flex items-center justify-between gap-2 pt-1 border-t">
          {details}
          {actions}
        </div>
      </MobileCard>
    );
  }

  return (
    <MobileCard>
      <MobileCardHeader>
        <Input
          type="date"
          value={draft.expense_date ?? ""}
          onChange={(ev) => onChange({ expense_date: ev.target.value || null })}
          className="flex-1"
        />
        <div className="flex gap-1 flex-shrink-0">
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
      </MobileCardHeader>

      <div>
        <MobileCardLabel>Supplier</MobileCardLabel>
        <Input
          value={draft.supplier ?? ""}
          onChange={(ev) => onChange({ supplier: ev.target.value || null })}
          className="w-full mt-1 font-medium"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <MobileCardLabel>Category</MobileCardLabel>
          <Input
            value={draft.category ?? ""}
            onChange={(ev) => onChange({ category: ev.target.value || null })}
            className="w-full mt-1"
          />
        </div>
        <div>
          <MobileCardLabel>Reference</MobileCardLabel>
          <Input
            value={draft.reference_number ?? ""}
            onChange={(ev) => onChange({ reference_number: ev.target.value || null })}
            className="w-full mt-1"
            placeholder="Invoice #"
          />
        </div>
      </div>

      <div>
        <MobileCardLabel>Association</MobileCardLabel>
        <Select
          value={draft.association_id ?? "none"}
          onValueChange={(v) => onChange({ association_id: v === "none" ? null : v })}
        >
          <SelectTrigger className="w-full mt-1">
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
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 border-t">
        {details}
        {actions}
      </div>
    </MobileCard>
  );
}
