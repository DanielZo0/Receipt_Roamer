import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OwnerCombobox, type AssociationLite, type OwnerLite } from "@/components/OwnerCombobox";
import { allocationStatus, hasUnknownAmount, remainderOf } from "@/lib/income-allocations";
import { type AllocationDraft, emptyDraft } from "@/lib/income-types";
import { formatMoney } from "@/lib/format";
import { Plus, X } from "lucide-react";

/** A money field cannot be driven directly by a `number`: an in-progress
 *  "12." or "-" has no numeric equivalent, so a controlled value would erase
 *  the character as fast as it is typed, and `Number("-")` would commit NaN
 *  into the split. Buffer the text, publish only what parses. */
function AllocationAmountInput({
  amount,
  label,
  onCommit,
}: {
  amount: number | null;
  label: string;
  onCommit: (amount: number | null) => void;
}) {
  const [text, setText] = useState(amount === null ? "" : String(amount));

  // Resync only when the numeric value genuinely changes elsewhere (cancel,
  // reload). A no-op parse like Number("12.") === 12 leaves `amount` equal,
  // so this does not fire and the user's in-progress text survives.
  useEffect(() => {
    setText(amount === null ? "" : String(amount));
  }, [amount]);

  return (
    <Input
      type="number"
      step="0.01"
      value={text}
      onChange={(ev) => {
        const raw = ev.target.value;
        setText(raw);
        if (raw === "") {
          onCommit(null);
          return;
        }
        const parsed = Number(raw);
        if (!Number.isNaN(parsed)) onCommit(parsed);
      }}
      className="w-24 flex-shrink-0"
      aria-label={label}
    />
  );
}

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
      {allocations.map((a, index) => {
        const ownerName = owners.find((o) => o.id === a.owner_id)?.name;
        const rowLabel = ownerName
          ? `Allocated amount for ${ownerName}`
          : `Allocated amount, row ${index + 1}`;
        return (
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
            <AllocationAmountInput
              amount={a.amount}
              label={rowLabel}
              onCommit={(amount) => update(a.key, { amount })}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="flex-shrink-0"
              title="Remove"
              aria-label={ownerName ? `Remove ${ownerName}` : `Remove row ${index + 1}`}
              onClick={() => onChange(allocations.filter((x) => x.key !== a.key))}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
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
              : hasUnknownAmount(paymentAmount, allocations)
                ? "Amount unknown"
                : `Unallocated: ${formatMoney(remainder, currency)}`}
          </span>
        )}
      </div>
    </div>
  );
}
