import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { OwnerCombobox } from "@/components/OwnerCombobox";
import { PaymentActions } from "@/components/income/payment-actions";
import type { PaymentRowProps } from "@/components/income/payment-mobile-card";
import { formatIsoDateDmy, formatMoney } from "@/lib/format";

export function PaymentTableRow({
  payment: p,
  owners,
  associations,
  condoName,
  selected,
  onToggleSelect,
  isEditing,
  draft,
  onChange,
  onEdit,
  onCancel,
  onSave,
  saving,
  onAssignOwner,
  onOpenFile,
  onDelete,
}: PaymentRowProps) {
  const deleteDescription = `This will permanently remove the payment from ${p.payer_name ?? "this payer"}${p.file_path ? " and its attached file" : ""}. This can't be undone.`;

  const actions = (
    <PaymentActions
      isEditing={isEditing}
      saving={saving}
      filePath={p.file_path}
      deleteDescription={deleteDescription}
      onEdit={onEdit}
      onCancel={onCancel}
      onSave={onSave}
      onOpenFile={onOpenFile}
      onDelete={onDelete}
    />
  );

  return (
    <TableRow className={!p.owner_id ? "bg-amber-500/5" : undefined}>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label={`Select payment from ${p.payer_name ?? "unknown"}`}
        />
      </TableCell>

      {isEditing ? (
        <>
          <TableCell>
            <Input
              type="date"
              value={draft.payment_date ?? ""}
              onChange={(ev) => onChange({ payment_date: ev.target.value || null })}
              className="w-28"
            />
          </TableCell>
          <TableCell>
            <Input
              value={draft.payer_name ?? ""}
              onChange={(ev) => onChange({ payer_name: ev.target.value || null })}
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
              value={draft.reference_string ?? ""}
              onChange={(ev) => onChange({ reference_string: ev.target.value || null })}
              className="min-w-32"
            />
          </TableCell>
        </>
      ) : (
        <>
          <TableCell className="whitespace-nowrap">
            {p.payment_date ? formatIsoDateDmy(p.payment_date) : "—"}
          </TableCell>
          <TableCell>{p.payer_name ?? "—"}</TableCell>
          <TableCell className="whitespace-nowrap">{formatMoney(p.amount, p.currency)}</TableCell>
          <TableCell className="max-w-48 truncate" title={p.reference_string ?? ""}>
            {p.reference_string ?? "—"}
          </TableCell>
        </>
      )}

      <TableCell>{condoName}</TableCell>
      <TableCell>
        <OwnerCombobox
          owners={owners}
          associations={associations}
          value={isEditing ? (draft.owner_id ?? null) : p.owner_id}
          onChange={(ownerId) =>
            isEditing ? onChange({ owner_id: ownerId }) : onAssignOwner(ownerId)
          }
          preferredCondominiumId={p.condominium_id}
        />
      </TableCell>
      <TableCell>
        {p.match_confidence != null ? (
          <Badge variant={p.owner_id ? "outline" : "destructive"}>
            {(p.match_confidence * 100).toFixed(0)}%
          </Badge>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell>{actions}</TableCell>
    </TableRow>
  );
}
