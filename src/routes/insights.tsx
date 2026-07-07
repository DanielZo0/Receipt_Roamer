import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AppNav } from "@/components/AppNav";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, TrendingDown } from "lucide-react";

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "Spending Insights · Receipt Tracker" },
      { name: "description", content: "Monthly spending per association compared to its recent average." },
    ],
  }),
  component: InsightsPage,
});

const ANOMALY_THRESHOLD = 0.3; // flag if current month is 30%+ above the trailing average
const TRAILING_MONTHS = 6;

type ExpenseLite = {
  association_id: string | null;
  amount: number | null;
  currency: string | null;
  expense_date: string | null;
};

type AssociationLite = { id: string; name: string };

type MonthlyInsight = {
  associationId: string;
  associationName: string;
  currency: string;
  currentMonthTotal: number;
  trailingAverage: number;
  deltaPct: number | null;
  monthsOfHistory: number;
};

function monthKey(dateStr: string) {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

function InsightsPage() {
  const { data: associations } = useQuery({
    queryKey: ["associations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("associations").select("id,name").order("name");
      if (error) throw error;
      return data as AssociationLite[];
    },
  });

  const { data: expenses, isLoading } = useQuery({
    queryKey: ["expenses-insights"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("association_id, amount, currency, expense_date")
        .not("expense_date", "is", null);
      if (error) throw error;
      return data as ExpenseLite[];
    },
  });

  const insights = useMemo<MonthlyInsight[]>(() => {
    if (!expenses || !associations) return [];

    const now = new Date();
    const currentMonth = monthKey(now.toISOString());

    // Build trailing month keys (excluding the current month), oldest first.
    const trailingMonths: string[] = [];
    for (let i = 1; i <= TRAILING_MONTHS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      trailingMonths.push(monthKey(d.toISOString()));
    }

    const result: MonthlyInsight[] = [];

    for (const assoc of associations) {
      const assocExpenses = expenses.filter((e) => e.association_id === assoc.id);
      if (assocExpenses.length === 0) continue;

      // Pick the most common currency for this association.
      const currencyCounts = new Map<string, number>();
      for (const e of assocExpenses) {
        const cur = e.currency ?? "—";
        currencyCounts.set(cur, (currencyCounts.get(cur) ?? 0) + 1);
      }
      const currency = Array.from(currencyCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];

      const inCurrency = assocExpenses.filter((e) => (e.currency ?? "—") === currency);

      const currentMonthTotal = inCurrency
        .filter((e) => e.expense_date && monthKey(e.expense_date) === currentMonth)
        .reduce((sum, e) => sum + Number(e.amount ?? 0), 0);

      const monthTotals = trailingMonths.map((m) =>
        inCurrency
          .filter((e) => e.expense_date && monthKey(e.expense_date) === m)
          .reduce((sum, e) => sum + Number(e.amount ?? 0), 0),
      );
      const monthsWithData = monthTotals.filter((t) => t > 0).length;
      const trailingAverage =
        monthsWithData > 0 ? monthTotals.reduce((a, b) => a + b, 0) / monthsWithData : 0;

      const deltaPct = trailingAverage > 0 ? (currentMonthTotal - trailingAverage) / trailingAverage : null;

      result.push({
        associationId: assoc.id,
        associationName: assoc.name,
        currency,
        currentMonthTotal,
        trailingAverage,
        deltaPct,
        monthsOfHistory: monthsWithData,
      });
    }

    // Surface anomalies first, then by current month spend descending.
    return result.sort((a, b) => {
      const aAnomaly = a.deltaPct != null && a.deltaPct >= ANOMALY_THRESHOLD;
      const bAnomaly = b.deltaPct != null && b.deltaPct >= ANOMALY_THRESHOLD;
      if (aAnomaly !== bAnomaly) return aAnomaly ? -1 : 1;
      return b.currentMonthTotal - a.currentMonthTotal;
    });
  }, [expenses, associations]);

  const fmt = (n: number, cur: string) =>
    new Intl.NumberFormat(undefined, {
      style: cur && cur !== "—" ? "currency" : "decimal",
      currency: cur && cur !== "—" ? cur : undefined,
    }).format(n);

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Spending Insights</h1>
          <p className="text-sm text-muted-foreground">
            This month's spend per association compared to its trailing {TRAILING_MONTHS}-month average.
            Flagged when {Math.round(ANOMALY_THRESHOLD * 100)}%+ above average.
          </p>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : insights.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            Not enough expense history yet to compute insights.
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {insights.map((i) => {
              const isAnomaly = i.deltaPct != null && i.deltaPct >= ANOMALY_THRESHOLD;
              const isDown = i.deltaPct != null && i.deltaPct < 0;
              return (
                <Card key={i.associationId} className={`p-4 ${isAnomaly ? "border-destructive" : ""}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-semibold truncate">{i.associationName}</h3>
                    {isAnomaly && <Badge variant="destructive">Above average</Badge>}
                  </div>
                  <p className="text-2xl font-bold tabular-nums">{fmt(i.currentMonthTotal, i.currency)}</p>
                  <p className="text-xs text-muted-foreground mt-1">This month</p>

                  {i.monthsOfHistory > 0 ? (
                    <div className="flex items-center gap-1 mt-2 text-sm">
                      {i.deltaPct != null && (
                        <>
                          {isDown ? (
                            <TrendingDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <TrendingUp className={`h-4 w-4 ${isAnomaly ? "text-destructive" : "text-muted-foreground"}`} />
                          )}
                          <span className={isAnomaly ? "text-destructive font-medium" : "text-muted-foreground"}>
                            {i.deltaPct >= 0 ? "+" : ""}
                            {(i.deltaPct * 100).toFixed(0)}% vs avg
                          </span>
                        </>
                      )}
                      <span className="text-muted-foreground">
                        (avg {fmt(i.trailingAverage, i.currency)} over {i.monthsOfHistory}mo)
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-2">No prior months to compare against yet.</p>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
