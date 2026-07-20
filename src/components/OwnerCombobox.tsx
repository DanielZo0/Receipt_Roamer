import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type OwnerLite = { id: string; name: string; apartment: string | null; condominium_id: string | null };
export type AssociationLite = { id: string; name: string };

interface OwnerComboboxProps {
  owners: OwnerLite[];
  associations: AssociationLite[];
  value: string | null;
  onChange: (ownerId: string | null) => void;
  /** Condominium id to prioritize at the top of the list (e.g. an AI-guessed match). */
  preferredCondominiumId?: string | null;
  placeholder?: string;
  className?: string;
}

export function OwnerCombobox({
  owners,
  associations,
  value,
  onChange,
  preferredCondominiumId,
  placeholder = "Select owner…",
  className,
}: OwnerComboboxProps) {
  const [open, setOpen] = useState(false);

  const selected = value ? owners.find((o) => o.id === value) : undefined;
  const associationName = (id: string | null) =>
    id ? associations.find((a) => a.id === id)?.name ?? "Unassigned condo" : "Unassigned condo";

  const groupOrder = [...associations.map((a) => a.id), "__none__"];
  if (preferredCondominiumId) {
    groupOrder.sort((a, b) => {
      if (a === preferredCondominiumId) return -1;
      if (b === preferredCondominiumId) return 1;
      return 0;
    });
  }

  const byGroup = new Map<string, OwnerLite[]>();
  for (const o of owners) {
    const key = o.condominium_id ?? "__none__";
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(o);
  }
  for (const list of byGroup.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("min-w-44 justify-between font-normal", className)}
        >
          <span className="truncate">
            {selected ? `${selected.name}${selected.apartment ? ` (Flt ${selected.apartment})` : ""}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search owner or condo…" />
          <CommandList>
            <CommandEmpty>No owner found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__unassigned__"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check className={cn("h-4 w-4", value ? "opacity-0" : "opacity-100")} />
                — unassigned —
              </CommandItem>
            </CommandGroup>
            {groupOrder.map((groupId) => {
              const groupOwners = byGroup.get(groupId);
              if (!groupOwners || groupOwners.length === 0) return null;
              return (
                <CommandGroup key={groupId} heading={associationName(groupId === "__none__" ? null : groupId)}>
                  {groupOwners.map((o) => (
                    <CommandItem
                      key={o.id}
                      value={`${o.name} ${o.apartment ?? ""} ${associationName(o.condominium_id)}`}
                      onSelect={() => {
                        onChange(o.id);
                        setOpen(false);
                      }}
                    >
                      <Check className={cn("h-4 w-4", value === o.id ? "opacity-100" : "opacity-0")} />
                      {o.name}
                      {o.apartment ? ` (Flt ${o.apartment})` : ""}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
