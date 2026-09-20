import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { needsAttention } from "@/lib/income-allocations";
import { Upload, FileText, DollarSign, ReceiptText, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Receipt Tracker · Dashboard" },
      {
        name: "description",
        content:
          "Upload receipts and bills, auto-extract their data, and allocate expenses to your owners associations.",
      },
    ],
  }),
  component: Index,
});

function StatCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`rounded-md p-2 ${tone === "warning" ? "bg-amber-500/10" : "bg-primary/10"}`}>
        <Icon
          className={`h-4 w-4 ${tone === "warning" ? "text-amber-600 dark:text-amber-400" : "text-primary"}`}
        />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold leading-tight">{value}</p>
      </div>
    </Card>
  );
}

function Index() {
  const { data: totals, isLoading: totalsLoading } = useQuery({
    queryKey: ["totals"],
    queryFn: async () => {
      const [{ data: assocs }, { data: exps }] = await Promise.all([
        supabase.from("associations").select("id,name").order("name"),
        supabase.from("expenses").select("association_id,amount,currency"),
      ]);
      const byAssoc = new Map<string, Map<string, number>>();
      let unassignedCount = 0;
      for (const e of exps ?? []) {
        const key = e.association_id ?? "__none__";
        if (key === "__none__") unassignedCount++;
        const cur = e.currency ?? "—";
        if (!byAssoc.has(key)) byAssoc.set(key, new Map());
        byAssoc.get(key)!.set(cur, (byAssoc.get(key)!.get(cur) ?? 0) + Number(e.amount ?? 0));
      }
      return {
        totalCount: exps?.length ?? 0,
        unassignedCount,
        associations: assocs ?? [],
        byAssoc,
      };
    },
  });

  const { data: recent } = useQuery({
    queryKey: ["recent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("expenses")
        .select("id, supplier, amount, currency, expense_date, association_id")
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const { data: incomeTotals, isLoading: incomeTotalsLoading } = useQuery({
    queryKey: ["income_totals"],
    queryFn: async () => {
      const [{ data: assocs }, { data: payments }, { data: allocations }] = await Promise.all([
        supabase.from("associations").select("id,name").order("name"),
        supabase.from("income_payments").select("id,amount,currency"),
        supabase.from("income_payment_allocations").select("payment_id,condominium_id,amount"),
      ]);

      const currencyByPayment = new Map((payments ?? []).map((p) => [p.id, p.currency ?? "—"]));
      const allocsByPayment = new Map<string, { amount: number | null }[]>();
      const byAssoc = new Map<string, Map<string, number>>();

      for (const a of allocations ?? []) {
        if (!allocsByPayment.has(a.payment_id)) allocsByPayment.set(a.payment_id, []);
        allocsByPayment.get(a.payment_id)!.push({ amount: a.amount });

        if (!a.condominium_id) continue;
        const cur = currencyByPayment.get(a.payment_id) ?? "—";
        if (!byAssoc.has(a.condominium_id)) byAssoc.set(a.condominium_id, new Map());
        byAssoc
          .get(a.condominium_id)!
          .set(cur, (byAssoc.get(a.condominium_id)!.get(cur) ?? 0) + Number(a.amount ?? 0));
      }

      // Reuse the single definition of "needs a human" rather than restating
      // the rule here -- a payment with no allocations AND an unknown amount
      // must count, which a bare remainder comparison would miss.
      const unmatchedCount = (payments ?? []).filter((p) =>
        needsAttention(p.amount, allocsByPayment.get(p.id) ?? []),
      ).length;

      return {
        totalCount: payments?.length ?? 0,
        unmatchedCount,
        associations: assocs ?? [],
        byAssoc,
      };
    },
  });

  const fmt = (n: number, cur: string) =>
    new Intl.NumberFormat(undefined, {
      style: cur && cur !== "—" ? "currency" : "decimal",
      currency: cur && cur !== "—" ? cur : undefined,
    }).format(n);

  return (
    <AppShell maxWidth="6xl">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Overview of your receipts and income.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/upload">
                <Upload className="h-4 w-4 mr-1" /> Upload receipt
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/income">
                <DollarSign className="h-4 w-4 mr-1" /> Add income
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/expenses">
                <FileText className="h-4 w-4 mr-1" /> All expenses
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          <StatCard
            icon={ReceiptText}
            label="Expenses tracked"
            value={totalsLoading ? "—" : String(totals?.totalCount ?? 0)}
          />
          <StatCard
            icon={AlertTriangle}
            label="Unassigned expenses"
            value={totalsLoading ? "—" : String(totals?.unassignedCount ?? 0)}
            tone={!totalsLoading && totals?.unassignedCount ? "warning" : "default"}
          />
          <StatCard
            icon={DollarSign}
            label="Unmatched payments"
            value={incomeTotalsLoading ? "—" : String(incomeTotals?.unmatchedCount ?? 0)}
            tone={!incomeTotalsLoading && incomeTotals?.unmatchedCount ? "warning" : "default"}
          />
        </div>

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Income per association
          </h2>
          {incomeTotals?.unmatchedCount ? (
            <Link
              to="/income"
              className="text-xs font-medium px-2 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
            >
              {incomeTotals.unmatchedCount} unmatched payment{incomeTotals.unmatchedCount === 1 ? "" : "s"} →
            </Link>
          ) : null}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
          {!incomeTotals || incomeTotals.totalCount === 0 ? (
            <Card className="p-6 col-span-full text-center">
              <p className="text-muted-foreground mb-3">No income payments yet.</p>
              <Button asChild variant="outline">
                <Link to="/income">
                  <DollarSign className="h-4 w-4 mr-1" /> Upload a payment
                </Link>
              </Button>
            </Card>
          ) : (
            incomeTotals.associations.map((a) => {
              const sums = incomeTotals.byAssoc.get(a.id);
              if (!sums || sums.size === 0) return null;
              return (
                <Card key={a.id} className="p-3 sm:p-4">
                  <h3 className="font-semibold mb-1 truncate">{a.name}</h3>
                  <ul className="text-sm space-y-0.5">
                    {Array.from(sums.entries()).map(([cur, sum]) => (
                      <li key={cur} className="text-foreground">
                        {fmt(sum, cur)}
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent transactions
          </h2>
          {recent && recent.length > 0 && (
            <Link to="/expenses" className="text-xs font-medium text-primary hover:underline">
              View all →
            </Link>
          )}
        </div>
        <Card className="overflow-x-auto">
          {recent && recent.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left font-medium text-muted-foreground px-4 py-2">Date</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-2">Supplier</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-2">
                    Association
                  </th>
                  <th className="text-right font-medium text-muted-foreground px-4 py-2">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recent.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                      {e.expense_date ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 font-medium truncate max-w-[220px]">
                      {e.supplier ?? "Unknown supplier"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[180px]">
                      {totals?.associations.find((a) => a.id === e.association_id)?.name ?? "unassigned"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {e.amount != null ? fmt(Number(e.amount), e.currency ?? "—") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No receipts yet.{" "}
              <Link to="/upload" className="underline">
                Upload your first one
              </Link>
              .
            </div>
          )}
        </Card>

        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3 mt-8">
          Totals per association
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
          {totals?.associations.length === 0 ? (
            <Card className="p-6 col-span-full text-center">
              <p className="text-muted-foreground mb-3">No associations yet.</p>
              <Button asChild variant="outline">
                <Link to="/associations">Add your first association</Link>
              </Button>
            </Card>
          ) : (
            totals?.associations.map((a) => {
              const sums = totals.byAssoc.get(a.id);
              return (
                <Card key={a.id} className="p-3 sm:p-4">
                  <h3 className="font-semibold mb-1 truncate">{a.name}</h3>
                  {sums && sums.size > 0 ? (
                    <ul className="text-sm space-y-0.5">
                      {Array.from(sums.entries()).map(([cur, sum]) => (
                        <li key={cur} className="text-foreground">
                          {fmt(sum, cur)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No expenses</p>
                  )}
                </Card>
              );
            })
          )}
          {totals?.unassignedCount ? (
            <Card className="p-4 border-dashed">
              <h3 className="font-semibold mb-1">Unassigned</h3>
              {(() => {
                const sums = totals.byAssoc.get("__none__");
                return sums && sums.size > 0 ? (
                  <ul className="text-sm space-y-0.5">
                    {Array.from(sums.entries()).map(([cur, sum]) => (
                      <li key={cur}>{fmt(sum, cur)}</li>
                    ))}
                  </ul>
                ) : null;
              })()}
            </Card>
          ) : null}
        </div>
    </AppShell>
  );
}
