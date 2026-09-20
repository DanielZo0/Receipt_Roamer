import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OwnerCombobox, type AssociationLite, type OwnerLite } from "@/components/OwnerCombobox";
import { allocationStatus, remainderOf } from "@/lib/income-allocations";
import { type AllocationDraft, emptyDraft } from "@/lib/income-types";
import { formatMoney } from "@/lib/format";
import { Plus, X } from "lucide-react";

export function AllocationEditor({
  allocations,
  onChange,
  owners,
  associations,
  paymentAmount,
  currency,
  preferredCondominiumId,
}: {
  allocations: AllocationDraft[];
  onChange: (next: AllocationDraft[]) => void;
  owners: OwnerLite[];
  associations: AssociationLite[];
  paymentAmount: number | null;
  currency: string | null;
  preferredCondominiumId: string | null;
}) {
  const remainder = remainderOf(paymentAmount, allocations);
  const status = allocationStatus(paymentAmount, allocations);

  function update(key: string, patch: Partial<AllocationDraft>) {
    onChange(allocations.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  }

  return (
    <div className="space-y-2">
      {allocations.map((a) => (
        <div key={a.key} className="flex items-center gap-1">
          <OwnerCombobox
            owners={owners}
            associations={associations}
            value={a.owner_id}
            onChange={(ownerId) =>
              update(a.key, {
                owner_id: ownerId,
                condominium_id: owners.find((o) => o.id === ownerId)?.condominium_id ?? null,
              })
            }
            preferredCondominiumId={preferredCondominiumId}
            className="flex-1 min-w-0"
          />
          <Input
            type="number"
            step="0.01"
            value={a.amount ?? ""}
            onChange={(ev) =>
              update(a.key, { amount: ev.target.value ? Number(ev.target.value) : null })
            }
            className="w-24 flex-shrink-0"
            aria-label="Allocated amount"
          />
          <Button
            size="icon"
            variant="ghost"
            className="flex-shrink-0"
            title="Remove"
            onClick={() => onChange(allocations.filter((x) => x.key !== a.key))}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange([...allocations, emptyDraft()])}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add owner
        </Button>

        {allocations.length > 0 && (
          <span
            className={`text-xs ${status === "allocated" ? "text-muted-foreground" : "text-amber-600"}`}
          >
            {status === "allocated"
              ? "Fully allocated"
              : paymentAmount === null || allocations.some((a) => a.amount === null)
                ? "Amount unknown"
                : `Unallocated: ${formatMoney(remainder, currency)}`}
          </span>
        )}
      </div>
    </div>
  );
}
