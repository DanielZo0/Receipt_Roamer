import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
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
import { toast } from "sonner";
import { ChevronDown, ChevronUp, ExternalLink, FileText, Pencil, Trash2, Plus, X, Save } from "lucide-react";

export const Route = createFileRoute("/categories")({
  head: () => ({
    meta: [
      { title: "Categories · Receipt Tracker" },
      { name: "description", content: "Manage expense categories." },
    ],
  }),
  component: CategoriesPage,
});

type CatRow = { id: string; name: string; keywords: string[] };

function CategoriesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id,name,keywords")
        .order("name");
      if (error) throw error;
      return data as CatRow[];
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  const upsert = useMutation({
    mutationFn: async (row: Partial<CatRow> & { id?: string }) => {
      if (row.id) {
        const { error } = await supabase
          .from("categories")
          .update({ name: row.name!, keywords: row.keywords ?? [] })
          .eq("id", row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("categories")
          .insert({ name: row.name!, keywords: row.keywords ?? [] });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      setEditingId(null);
      setAdding(false);
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Expense Categories</h1>
            <p className="text-sm text-muted-foreground">
              Add keywords (supplier names, generic terms) so the AI can auto-categorise expenses.
            </p>
          </div>
          {!adding && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4 mr-1" /> New
            </Button>
          )}
        </div>

        {adding && (
          <EditCard
            onCancel={() => setAdding(false)}
            onSave={(row) => upsert.mutate(row)}
            saving={upsert.isPending}
          />
        )}

        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : data && data.length > 0 ? (
          <div className="space-y-3">
            {data.map((c) =>
              editingId === c.id ? (
                <EditCard
                  key={c.id}
                  initial={c}
                  onCancel={() => setEditingId(null)}
                  onSave={(row) => upsert.mutate({ ...row, id: c.id })}
                  saving={upsert.isPending}
                />
              ) : (
                <Card key={c.id} className="overflow-hidden">
                  <div
                    className="p-4 flex items-start justify-between gap-4 cursor-pointer select-none hover:bg-muted/30 transition-colors"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("button")) return;
                      toggleExpand(c.id);
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{c.name}</h3>
                        {expandedId === c.id ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      {c.keywords?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {c.keywords.map((k) => (
                            <span
                              key={k}
                              className="text-xs bg-secondary text-secondary-foreground rounded px-2 py-0.5"
                            >
                              {k}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setEditingId(c.id)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete "${c.name}"?`)) del.mutate(c.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {expandedId === c.id && (
                    <div className="border-t">
                      <CatReceipts categoryName={c.name} />
                    </div>
                  )}
                </Card>
              ),
            )}
          </div>
        ) : (
          !adding && (
            <Card className="p-8 text-center text-muted-foreground">
              No categories yet. Add one to get started.
            </Card>
          )
        )}
      </main>
    </div>
  );
}

// ─── Receipts panel ───────────────────────────────────────────────────────────

type ExpenseRow = {
  id: string;
  supplier: string | null;
  expense_date: string | null;
  amount: number | null;
  currency: string | null;
  file_path: string | null;
  association_id: string | null;
};

function CatReceipts({ categoryName }: { categoryName: string }) {
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

  const { data, isLoading } = useQuery({
    queryKey: ["cat-receipts", categoryName],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("id,supplier,expense_date,amount,currency,file_path,association_id")
        .eq("category", categoryName)
        .order("expense_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ExpenseRow[];
    },
  });

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

  const assocName = (id: string | null) =>
    id ? associations?.find((a) => a.id === id)?.name ?? "—" : "—";

  if (isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading receipts…</p>;
  }

  if (!data || data.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No receipts in this category yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Association</TableHead>
            <TableHead className="w-10">File</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="text-sm tabular-nums">
                {e.expense_date ?? "—"}
              </TableCell>
              <TableCell className="text-sm">{e.supplier ?? "—"}</TableCell>
              <TableCell className="text-sm tabular-nums">
                {e.amount != null
                  ? `${e.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${e.currency ?? ""}`
                  : "—"}
              </TableCell>
              <TableCell className="text-sm">{assocName(e.association_id)}</TableCell>
              <TableCell>
                {e.file_path ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => openFile(e.file_path)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Edit form ────────────────────────────────────────────────────────────────

function EditCard({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: CatRow;
  onSave: (row: { name: string; keywords: string[] }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [keywords, setKeywords] = useState((initial?.keywords ?? []).join(", "));

  return (
    <Card className="p-4 mb-3 space-y-3">
      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lifts" />
      </div>
      <div>
        <Label>Keywords (comma-separated)</Label>
        <Input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="e.g. lift, elevator, SS Lifts, Otis, Schindler"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Supplier names or generic terms that hint at this category.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          <X className="h-4 w-4 mr-1" /> Cancel
        </Button>
        <Button
          disabled={!name.trim() || saving}
          onClick={() =>
            onSave({
              name: name.trim(),
              keywords: keywords.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
        >
          <Save className="h-4 w-4 mr-1" /> Save
        </Button>
      </div>
    </Card>
  );
}