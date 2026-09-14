import { useQuery } from "@tanstack/react-query";
import { matchesAllConditions, type RuleCondition, type RuleEvaluationTarget } from "@/lib/extraction/rule-engine";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";

type ExpenseRow = {
  id: string;
  supplier: string | null;
  amount: number | null;
  category: string | null;
  currency: string | null;
  association_id: string | null;
};

function toTarget(e: ExpenseRow): RuleEvaluationTarget {
  return {
    supplier: e.supplier,
    amount: e.amount,
    category: e.category,
    currency: e.currency,
    association_id: e.association_id,
    // The expenses table does not persist the inbound sender email (it's only
    // available in-memory at extraction time), so a sender_email condition can
    // never match a previewed historical expense — this correctly reflects
    // that we have no sender_email data to preview against, rather than
    // guessing or querying a column that doesn't exist.
    sender_email: null,
  };
}

export function RulePreview({ conditions }: { conditions: RuleCondition[] }) {
  const { data: expenses, isLoading } = useQuery({
    queryKey: ["rule-preview-expenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("id, supplier, amount, category, currency, association_id")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as ExpenseRow[];
    },
  });

  const hasValidCondition = conditions.some((c) => String(c.value).trim().length > 0);
  const matches = hasValidCondition
    ? (expenses ?? []).filter((e) => matchesAllConditions(conditions, toTarget(e)))
    : [];

  return (
    <Card className="p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Preview: matches against your 20 most recent expenses
      </p>
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !hasValidCondition ? (
        <p className="text-muted-foreground">Fill in a condition value to see matches.</p>
      ) : matches.length === 0 ? (
        <p className="text-muted-foreground">No matches among the 20 most recent expenses.</p>
      ) : (
        <ul className="space-y-1">
          {matches.map((m) => (
            <li key={m.id} className="truncate">
              {m.supplier ?? "(no supplier)"} — {m.currency ?? ""} {m.amount ?? ""}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
