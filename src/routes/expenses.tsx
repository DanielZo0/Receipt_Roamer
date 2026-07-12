import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { AppNav } from "@/components/AppNav";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Trash2, FileText, ExternalLink, Info } from "lucide-react";

export const Route = createFileRoute("/expenses")({
  head: () => ({
    meta: [
      { title: "Expenses · Receipt Tracker" },
      { name: "description", content: "Search, filter, and export your tracked expenses." },
    ],
  }),
  component: ExpensesPage,
});

type ExpenseRow = {
  id: string;
  association_id: string | null;
  supplier: string | null;
  expense_date: string | null;
  amount: number | null;
  currency: string | null;
  category: string | null;
  reference_number: string | null;
  file_path: string | null;
  file_mime: string | null;
  created_at: string;
};

type ValidationIssue = { field: string; value: unknown; reason: string; severity: "error" | "warning" };

type AuditLogRow = {
  expense_id: string;
  phase: string;
  validation_errors: ValidationIssue[] | null;
  validation_warnings: ValidationIssue[] | null;
  association_match_confidence: number | null;
  association_match_signals: string[] | null;
  extraction_reasoning: string | null;
  possible_duplicate_of: string | null;
  created_at: string;
};

function ExpensesPage() {
  const qc = useQueryClient();
  const { data: associations } = useQuery({
    queryKey: ["associations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("associations")
        .select("id,name")
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const { data: expenses, isLoading } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("*")
        .order("expense_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ExpenseRow[];
    },
  });

  const { data: auditLogs } = useQuery({
    queryKey: ["extraction-audit-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("extraction_audit_log")
        .select(
          "expense_id, phase, validation_errors, validation_warnings, association_match_confidence, association_match_signals, extraction_reasoning, possible_duplicate_of, created_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AuditLogRow[];
    },
  });

  // Keep only the most recent audit entry per expense (query is already sorted desc).
  const auditByExpense = useMemo(() => {
    const map = new Map<string, AuditLogRow>();
    for (const row of auditLogs ?? []) {
      if (!map.has(row.expense_id)) map.set(row.expense_id, row);
    }
    return map;
  }, [auditLogs]);

  const [search, setSearch] = useState("");
  const [assocFilter, setAssocFilter] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(() => {
    if (!expenses) return [];
    const q = search.trim().toLowerCase();
    return expenses.filter((e) => {
      if (assocFilter !== "all" && (e.association_id ?? "none") !== assocFilter) return false;
      if (from && (!e.expense_date || e.expense_date < from)) return false;
      if (to && (!e.expense_date || e.expense_date > to)) return false;
      if (q) {
        const s = `${e.supplier ?? ""} ${e.category ?? ""} ${e.reference_number ?? ""}`.toLowerCase();
        if (!s.includes(q)) return false;
      }
      return true;
    });
  }, [expenses, search, assocFilter, from, to]);

  const assocName = (id: string | null) =>
    id ? associations?.find((a) => a.id === id)?.name ?? "—" : "—";

  const update = useMutation({
    mutationFn: async (row: Partial<ExpenseRow> & { id: string }) => {
      const { id, ...rest } = row;
      const original = expenses?.find((e) => e.id === id);

      const { error } = await supabase.from("expenses").update(rest).eq("id", id);
      if (error) throw error;

      // Capture each changed field as a correction (Phase 2: human-in-the-loop learning).
      if (original) {
        const corrections = Object.entries(rest)
          .filter(([field, value]) => (original as Record<string, unknown>)[field] !== value)
          .map(([field, value]) => ({
            expense_id: id,
            field,
            original_value: (original as Record<string, unknown>)[field]?.toString() ?? null,
            corrected_value: value?.toString() ?? null,
          }));
        if (corrections.length > 0) {
          await supabase.from("expense_corrections").insert(corrections);
        }
      }

      return { original, rest };
    },
    onSuccess: ({ original, rest }) => {
      qc.invalidateQueries({ queryKey: ["expenses"] });

      // If the association was corrected, offer to save it as a learned rule.
      if (
        original &&
        "association_id" in rest &&
        rest.association_id &&
        rest.association_id !== original.association_id &&
        original.supplier
      ) {
        const supplier = original.supplier;
        const associationId = rest.association_id as string;
        const associationName = associations?.find((a) => a.id === associationId)?.name ?? "this association";
        const pattern = supplier.toLowerCase().trim();
        const matchCount =
          expenses?.filter((e) => e.id !== original.id && e.supplier?.toLowerCase().includes(pattern)).length ?? 0;

        toast(`Always match "${supplier}" to ${associationName}?`, {
          description: matchCount > 0 ? `Also matches ${matchCount} other expense${matchCount === 1 ? "" : "s"}.` : undefined,
          action: {
            label: "Save rule",
            onClick: async () => {
              const { error } = await supabase.from("association_rules").insert({
                supplier_pattern: pattern,
                association_id: associationId,
                source_expense_id: original.id,
              });
              if (error) {
                // Unique constraint violation just means the rule already exists.
                if (error.code !== "23505") toast.error(error.message);
              } else {
                toast.success("Rule saved");
              }
            },
          },
        });
      }

      // If the category was corrected, offer to save it as a learned rule.
      if (
        original &&
        "category" in rest &&
        rest.category &&
        rest.category !== original.category &&
        original.supplier
      ) {
        const supplier = original.supplier;
        const category = rest.category as string;
        const pattern = supplier.toLowerCase().trim();
        const matchCount =
          expenses?.filter((e) => e.id !== original.id && e.supplier?.toLowerCase().includes(pattern)).length ?? 0;

        toast(`Always categorize "${supplier}" as ${category}?`, {
          description: matchCount > 0 ? `Also matches ${matchCount} other expense${matchCount === 1 ? "" : "s"}.` : undefined,
          action: {
            label: "Save rule",
            onClick: async () => {
              const { error } = await supabase.from("category_rules").insert({
                supplier_pattern: pattern,
                category,
                source_expense_id: original.id,
              });
              if (error) {
                if (error.code !== "23505") toast.error(error.message);
              } else {
                toast.success("Rule saved");
              }
            },
          },
        });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (row: ExpenseRow) => {
      if (row.file_path) {
        await supabase.storage.from("receipts").remove([row.file_path]);
      }
      const { error } = await supabase.from("expenses").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      toast.success("Deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function exportCsv() {
    const headers = ["Date", "Supplier", "Amount", "Currency", "Category", "Reference", "Association"];
    const rows = filtered.map((e) => [
      e.expense_date ?? "",
      e.supplier ?? "",
      e.amount?.toString() ?? "",
      e.currency ?? "",
      e.category ?? "",
      e.reference_number ?? "",
      assocName(e.association_id),
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function openFile(path: string | null) {
    if (!path) return;
    const { data, error } = await supabase.storage
      .from("receipts")
      .createSignedUrl(path, 60 * 5);
    if (error || !data?.signedUrl) {
      toast.error("Could not open file");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <h1 className="text-2xl font-bold">Expenses</h1>
          <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>

        <Card className="p-4 mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder="Search supplier / category / reference" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={assocFilter} onValueChange={setAssocFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Association" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All associations</SelectItem>
              <SelectItem value="none">Unassigned</SelectItem>
              {associations?.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="From" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" />
        </Card>

        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Association</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Details</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No expenses match.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Input
                        type="date"
                        defaultValue={e.expense_date ?? ""}
                        onBlur={(ev) =>
                          ev.target.value !== (e.expense_date ?? "") &&
                          update.mutate({ id: e.id, expense_date: ev.target.value || null })
                        }
                        className="w-36"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        defaultValue={e.supplier ?? ""}
                        onBlur={(ev) =>
                          ev.target.value !== (e.supplier ?? "") &&
                          update.mutate({ id: e.id, supplier: ev.target.value || null })
                        }
                        className="min-w-40"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Input
                          type="number"
                          step="0.01"
                          defaultValue={e.amount ?? ""}
                          onBlur={(ev) => {
                            const v = ev.target.value ? Number(ev.target.value) : null;
                            if (v !== e.amount) update.mutate({ id: e.id, amount: v });
                          }}
                          className="w-24"
                        />
                        <Input
                          defaultValue={e.currency ?? ""}
                          onBlur={(ev) =>
                            ev.target.value !== (e.currency ?? "") &&
                            update.mutate({ id: e.id, currency: ev.target.value || null })
                          }
                          className="w-16"
                          placeholder="EUR"
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input
                        defaultValue={e.category ?? ""}
                        onBlur={(ev) =>
                          ev.target.value !== (e.category ?? "") &&
                          update.mutate({ id: e.id, category: ev.target.value || null })
                        }
                        className="min-w-28"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        defaultValue={e.reference_number ?? ""}
                        onBlur={(ev) =>
                          ev.target.value !== (e.reference_number ?? "") &&
                          update.mutate({ id: e.id, reference_number: ev.target.value || null })
                        }
                        className="min-w-28"
                        placeholder="Invoice #"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={e.association_id ?? "none"}
                        onValueChange={(v) =>
                          update.mutate({ id: e.id, association_id: v === "none" ? null : v })
                        }
                      >
                        <SelectTrigger className="min-w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— unassigned —</SelectItem>
                          {associations?.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {e.file_path ? (
                        <Button size="icon" variant="ghost" onClick={() => openFile(e.file_path)}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      ) : (
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell>
                      <ExtractionDetails
                        audit={auditByExpense.get(e.id) ?? null}
                        duplicateExpense={
                          expenses?.find((x) => x.id === auditByExpense.get(e.id)?.possible_duplicate_of) ?? null
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("Delete this expense?")) del.mutate(e);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </main>
    </div>
  );
}

function ExtractionDetails({
  audit,
  duplicateExpense,
}: {
  audit: AuditLogRow | null;
  duplicateExpense: ExpenseRow | null;
}) {
  if (!audit) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  const errorCount = audit.validation_errors?.length ?? 0;
  const warningCount = audit.validation_warnings?.length ?? 0;
  const confidence = audit.association_match_confidence;
  const rechecked = audit.phase === "llm_recheck";
  const isDuplicate = !!audit.possible_duplicate_of;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="relative">
          <Info className="h-4 w-4" />
          {(errorCount > 0 || warningCount > 0 || isDuplicate) && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="space-y-2 text-sm">
        <div className="flex flex-wrap gap-1">
          {isDuplicate && <Badge variant="destructive">Possible duplicate</Badge>}
          {rechecked && <Badge variant="secondary">Re-checked by LLM</Badge>}
          {confidence != null && (
            <Badge variant="outline">
              Association match: {(confidence * 100).toFixed(0)}%
            </Badge>
          )}
          {errorCount > 0 && <Badge variant="destructive">{errorCount} error{errorCount === 1 ? "" : "s"}</Badge>}
          {warningCount > 0 && <Badge variant="secondary">{warningCount} warning{warningCount === 1 ? "" : "s"}</Badge>}
        </div>

        {isDuplicate && (
          <p className="text-xs text-muted-foreground">
            Matches an existing expense
            {duplicateExpense ? ` from ${duplicateExpense.expense_date ?? "an unknown date"} (${duplicateExpense.supplier ?? "same supplier"})` : ""}.
          </p>
        )}

        {audit.association_match_signals && audit.association_match_signals.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Matched by: {audit.association_match_signals.join(", ")}
          </p>
        )}

        {audit.extraction_reasoning && (
          <p className="text-xs">{audit.extraction_reasoning}</p>
        )}

        {(errorCount > 0 || warningCount > 0) && (
          <ul className="text-xs space-y-0.5 border-t pt-1.5">
            {[...(audit.validation_errors ?? []), ...(audit.validation_warnings ?? [])].map(
              (issue, i) => (
                <li key={i} className={issue.severity === "error" ? "text-destructive" : "text-muted-foreground"}>
                  {issue.field}: {issue.reason}
                </li>
              ),
            )}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}