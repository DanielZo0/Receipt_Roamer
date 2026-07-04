import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppNav } from "@/components/AppNav";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/corrections")({
  head: () => ({
    meta: [
      { title: "Corrections History · Receipt Tracker" },
      { name: "description", content: "History of manual corrections made to extracted expenses." },
    ],
  }),
  component: CorrectionsPage,
});

type CorrectionRow = {
  id: string;
  expense_id: string;
  field: string;
  original_value: string | null;
  corrected_value: string | null;
  created_at: string;
};

type ExpenseLite = {
  id: string;
  supplier: string | null;
  expense_date: string | null;
};

type AssociationLite = { id: string; name: string };

function CorrectionsPage() {
  const { data: corrections, isLoading } = useQuery({
    queryKey: ["expense-corrections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_corrections")
        .select("id, expense_id, field, original_value, corrected_value, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CorrectionRow[];
    },
  });

  const { data: expenses } = useQuery({
    queryKey: ["expenses-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("id, supplier, expense_date");
      if (error) throw error;
      return data as ExpenseLite[];
    },
  });

  const { data: associations } = useQuery({
    queryKey: ["associations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("associations").select("id,name").order("name");
      if (error) throw error;
      return data as AssociationLite[];
    },
  });

  const expenseById = useMemo(() => {
    const map = new Map<string, ExpenseLite>();
    for (const e of expenses ?? []) map.set(e.id, e);
    return map;
  }, [expenses]);

  const associationById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of associations ?? []) map.set(a.id, a.name);
    return map;
  }, [associations]);

  const [fieldFilter, setFieldFilter] = useState<string>("all");

  const fields = useMemo(() => {
    const set = new Set<string>();
    for (const c of corrections ?? []) set.add(c.field);
    return Array.from(set).sort();
  }, [corrections]);

  const filtered = useMemo(() => {
    if (!corrections) return [];
    if (fieldFilter === "all") return corrections;
    return corrections.filter((c) => c.field === fieldFilter);
  }, [corrections, fieldFilter]);

  function displayValue(field: string, value: string | null) {
    if (value == null) return "—";
    if (field === "association_id") return associationById.get(value) ?? value;
    return value;
  }

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Corrections History</h1>
            <p className="text-sm text-muted-foreground">
              Every manual edit made to an extracted expense. Useful for spotting patterns worth saving as a rule
              on the Expenses page.
            </p>
          </div>
          <Select value={fieldFilter} onValueChange={setFieldFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Field" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All fields</SelectItem>
              {fields.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Expense</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Original</TableHead>
                <TableHead>Corrected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No corrections recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c) => {
                  const expense = expenseById.get(c.expense_id);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="text-sm tabular-nums whitespace-nowrap">
                        {new Date(c.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {expense?.supplier ?? "—"}
                        {expense?.expense_date ? ` (${expense.expense_date})` : ""}
                      </TableCell>
                      <TableCell className="text-sm font-mono">{c.field}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {displayValue(c.field, c.original_value)}
                      </TableCell>
                      <TableCell className="text-sm">{displayValue(c.field, c.corrected_value)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </main>
    </div>
  );
}
