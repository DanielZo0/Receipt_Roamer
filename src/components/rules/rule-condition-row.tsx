import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import type { RuleCondition, RuleField, RuleOperator } from "@/lib/extraction/rule-engine";

export const FIELD_OPTIONS: { value: RuleField; label: string; kind: "text" | "number" }[] = [
  { value: "supplier", label: "Supplier", kind: "text" },
  { value: "amount", label: "Amount", kind: "number" },
  { value: "category", label: "Category", kind: "text" },
  { value: "currency", label: "Currency", kind: "text" },
  { value: "association_id", label: "Association", kind: "text" },
  { value: "sender_email", label: "Sender email", kind: "text" },
];

const TEXT_OPERATORS: { value: RuleOperator; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "regex", label: "matches regex" },
];

const NUMBER_OPERATORS: { value: RuleOperator; label: string }[] = [
  { value: "gt", label: "greater than" },
  { value: "gte", label: "at least" },
  { value: "lt", label: "less than" },
  { value: "lte", label: "at most" },
  { value: "equals", label: "equals" },
  { value: "between", label: "between" },
];

export function RuleConditionRow({
  condition,
  associations,
  senderEmails,
  onChange,
  onRemove,
  removable,
}: {
  condition: RuleCondition;
  associations: { id: string; name: string }[];
  senderEmails: string[];
  onChange: (patch: Partial<RuleCondition>) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const fieldMeta = FIELD_OPTIONS.find((f) => f.value === condition.field)!;
  const operatorOptions = fieldMeta.kind === "number" ? NUMBER_OPERATORS : TEXT_OPERATORS;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={condition.field}
        onValueChange={(v) => onChange({ field: v as RuleField, operator: "contains", value: "" })}
      >
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELD_OPTIONS.map((f) => (
            <SelectItem key={f.value} value={f.value}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={condition.operator} onValueChange={(v) => onChange({ operator: v as RuleOperator })}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operatorOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {condition.field === "association_id" ? (
        <Select value={String(condition.value)} onValueChange={(v) => onChange({ value: v })}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Association" />
          </SelectTrigger>
          <SelectContent>
            {associations.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : condition.field === "sender_email" ? (
        <Select value={String(condition.value)} onValueChange={(v) => onChange({ value: v })}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Sender email" />
          </SelectTrigger>
          <SelectContent>
            {senderEmails.map((email) => (
              <SelectItem key={email} value={email}>
                {email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          className="w-40"
          type={fieldMeta.kind === "number" ? "number" : "text"}
          value={condition.value}
          onChange={(e) =>
            onChange({ value: fieldMeta.kind === "number" ? Number(e.target.value) : e.target.value })
          }
          placeholder="value"
        />
      )}
      {condition.operator === "between" && (
        <Input
          className="w-28"
          type="number"
          value={condition.value2 ?? ""}
          onChange={(e) => onChange({ value2: Number(e.target.value) })}
          placeholder="and…"
        />
      )}
      <Button size="icon" variant="ghost" onClick={onRemove} disabled={!removable}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
