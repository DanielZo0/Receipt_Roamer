import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { OwnerCombobox } from "@/components/OwnerCombobox";
import { AllocationEditor } from "@/components/income/allocation-editor";
import { PaymentActions } from "@/components/income/payment-actions";
import type { PaymentRowProps } from "@/components/income/payment-mobile-card";
import { hasUnknownAmount, needsAttention, remainderOf } from "@/lib/income-allocations";
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
  allocations,
  allocationDraft,
  onAllocationChange,
  ownerName,
}: PaymentRowProps) {
  const deleteDescription = `This will permanently remove the payment from ${p.payer_name ?? "this payer"}${p.file_path ? " and its attached file" : ""}. This can't be undone.`;
  // p.owner_id is only a mirror of the single-allocation case -- it is NULL for
  // any split, so it cannot answer "does this need attention?".
  const attention = needsAttention(p.amount, allocations);

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
    <TableRow className={attention ? "bg-amber-500/5" : undefined}>
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
      <TableCell className="min-w-64">
        {isEditing ? (
          <AllocationEditor
            allocations={allocationDraft}
            onChange={onAllocationChange}
            owners={owners}
            associations={associations}
            // `??` would treat a deliberately cleared field as "unset" and fall
            // back to the stale value, so the remainder would be computed
            // against a number the user just deleted.
            paymentAmount={draft.amount === undefined ? p.amount : draft.amount}
            currency={draft.currency === undefined ? p.currency : draft.currency}
            preferredCondominiumId={allocations[0]?.condominium_id ?? p.matched_condominium_id}
          />
        ) : (
          <>
            {allocations.length <= 1 ? (
              <OwnerCombobox
                owners={owners}
                associations={associations}
                value={allocations[0]?.owner_id ?? null}
                onChange={onAssignOwner}
                preferredCondominiumId={allocations[0]?.condominium_id ?? p.matched_condominium_id}
              />
            ) : (
              <div className="space-y-0.5">
                {allocations.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{ownerName(a.owner_id)}</span>
                    <span className="flex-shrink-0 font-mono">
                      {formatMoney(a.amount, p.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {allocations.length > 0 && needsAttention(p.amount, allocations) && (
              <span className="mt-1 block text-xs text-amber-600">
                {hasUnknownAmount(p.amount, allocations)
                  ? "Amount unknown"
                  : `Unallocated: ${formatMoney(remainderOf(p.amount, allocations), p.currency)}`}
              </span>
            )}
          </>
        )}
      </TableCell>
      <TableCell>
        {p.match_confidence != null ? (
          <Badge variant={attention ? "destructive" : "outline"}>
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
