import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import type { RuleAction, RuleActionType } from "@/lib/extraction/rule-engine";

export const ACTION_OPTIONS: { value: RuleActionType; label: string }[] = [
  { value: "set_category", label: "Set category" },
  { value: "set_association", label: "Set association" },
  { value: "flag_for_review", label: "Flag for review" },
  { value: "notify", label: "Notify me" },
];

export function RuleActionRow({
  action,
  associations,
  categories,
  onChange,
  onRemove,
  removable,
}: {
  action: RuleAction;
  associations: { id: string; name: string }[];
  categories: string[];
  onChange: (patch: Partial<RuleAction>) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={action.type} onValueChange={(v) => onChange({ type: v as RuleActionType, value: "" })}>
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACTION_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {action.type === "set_category" && (
        <Select value={action.value ?? ""} onValueChange={(v) => onChange({ value: v })}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {action.type === "set_association" && (
        <Select value={action.value ?? ""} onValueChange={(v) => onChange({ value: v })}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Association" />
          </SelectTrigger>
          <SelectContent>
            {associations.map((assoc) => (
              <SelectItem key={assoc.id} value={assoc.id}>
                {assoc.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button size="icon" variant="ghost" onClick={onRemove} disabled={!removable}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
