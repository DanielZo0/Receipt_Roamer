import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  MobileCard,
  MobileCardHeader,
  MobileCardLabel,
  MobileCardRow,
} from "@/components/ui/responsive-table";
import { OwnerCombobox, type AssociationLite, type OwnerLite } from "@/components/OwnerCombobox";
import { PaymentActions } from "@/components/income/payment-actions";
import type { PaymentRow } from "@/lib/income-types";
import { formatIsoDateDmy, formatMoney } from "@/lib/format";

export type PaymentRowProps = {
  payment: PaymentRow;
  owners: OwnerLite[];
  associations: AssociationLite[];
  condoName: string;
  selected: boolean;
  onToggleSelect: () => void;
  isEditing: boolean;
  draft: Partial<PaymentRow>;
  onChange: (patch: Partial<PaymentRow>) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  /** Assigns an owner straight away, outside edit mode. */
  onAssignOwner: (ownerId: string | null) => void;
  onOpenFile: () => void;
  onDelete: () => void;
  extra?: ReactNode;
};

export function PaymentMobileCard({
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

  if (!isEditing) {
    return (
      <MobileCard className={!p.owner_id ? "bg-amber-500/5" : undefined}>
        <MobileCardHeader>
          <div className="flex items-center gap-2 min-w-0">
            <Checkbox
              checked={selected}
              onCheckedChange={onToggleSelect}
              aria-label={`Select payment from ${p.payer_name ?? "unknown"}`}
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {p.payment_date ? formatIsoDateDmy(p.payment_date) : "—"}
            </span>
          </div>
          <span className="font-semibold whitespace-nowrap">
            {formatMoney(p.amount, p.currency)}
          </span>
        </MobileCardHeader>

        <div className="flex items-center justify-between gap-2">
          <span className="font-medium truncate">{p.payer_name ?? "—"}</span>
          {p.match_confidence != null && (
            <Badge variant={p.owner_id ? "outline" : "destructive"} className="flex-shrink-0">
              {(p.match_confidence * 100).toFixed(0)}%
            </Badge>
          )}
        </div>

        {p.reference_string && (
          <p className="text-xs text-muted-foreground truncate" title={p.reference_string}>
            {p.reference_string}
          </p>
        )}

        <MobileCardRow>
          <MobileCardLabel>Condo</MobileCardLabel>
          <span className="min-w-0 truncate">{condoName}</span>
        </MobileCardRow>

        {/* Assigning an owner is this page's main job, so it stays usable
            without switching the card into edit mode. */}
        <OwnerCombobox
          owners={owners}
          associations={associations}
          value={p.owner_id}
          onChange={onAssignOwner}
          preferredCondominiumId={p.condominium_id}
          className="w-full"
        />

        <div className="flex items-center justify-end gap-1 pt-1 border-t">{actions}</div>
      </MobileCard>
    );
  }

  return (
    <MobileCard className={!p.owner_id ? "bg-amber-500/5" : undefined}>
      <MobileCardHeader>
        <Input
          type="date"
          value={draft.payment_date ?? ""}
          onChange={(ev) => onChange({ payment_date: ev.target.value || null })}
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
        <MobileCardLabel>Payer</MobileCardLabel>
        <Input
          value={draft.payer_name ?? ""}
          onChange={(ev) => onChange({ payer_name: ev.target.value || null })}
          className="w-full mt-1 font-medium"
        />
      </div>

      <div>
        <MobileCardLabel>Reference</MobileCardLabel>
        <Input
          value={draft.reference_string ?? ""}
          onChange={(ev) => onChange({ reference_string: ev.target.value || null })}
          className="w-full mt-1"
        />
      </div>

      <div>
        <MobileCardLabel>Owner</MobileCardLabel>
        <OwnerCombobox
          owners={owners}
          associations={associations}
          value={draft.owner_id ?? null}
          onChange={(ownerId) => onChange({ owner_id: ownerId })}
          preferredCondominiumId={p.condominium_id}
          className="w-full mt-1"
        />
      </div>

      <div className="flex items-center justify-end gap-1 pt-1 border-t">{actions}</div>
    </MobileCard>
  );
}
