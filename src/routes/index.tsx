import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppNav } from "@/components/AppNav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Upload, FileText } from "lucide-react";

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

function Index() {
  const { data: totals } = useQuery({
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

  const fmt = (n: number, cur: string) =>
    new Intl.NumberFormat(undefined, {
      style: cur && cur !== "—" ? "currency" : "decimal",
      currency: cur && cur !== "—" ? cur : undefined,
    }).format(n);

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {totals?.totalCount ?? 0} expenses tracked
              {totals?.unassignedCount ? ` · ${totals.unassignedCount} unassigned` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild>
              <Link to="/upload">
                <Upload className="h-4 w-4 mr-1" /> Upload receipt
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/expenses">
                <FileText className="h-4 w-4 mr-1" /> All expenses
              </Link>
            </Button>
          </div>
        </div>

        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Totals per association
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
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
                <Card key={a.id} className="p-4">
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

        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Recent uploads
        </h2>
        <Card>
          {recent && recent.length > 0 ? (
            <ul className="divide-y">
              {recent.map((e) => (
                <li key={e.id} className="p-4 flex justify-between items-center">
                  <div>
                    <p className="font-medium">{e.supplier ?? "Unknown supplier"}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.expense_date ?? "no date"} ·{" "}
                      {totals?.associations.find((a) => a.id === e.association_id)?.name ?? "unassigned"}
                    </p>
                  </div>
                  <p className="font-mono text-sm">
                    {e.amount != null ? fmt(Number(e.amount), e.currency ?? "—") : "—"}
                  </p>
                </li>
              ))}
            </ul>
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
      </main>
    </div>
  );
}
