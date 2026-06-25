import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { AppNav } from "@/components/AppNav";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Pencil, Trash2, Plus, X, Save } from "lucide-react";

export const Route = createFileRoute("/associations")({
  head: () => ({
    meta: [
      { title: "Associations · Receipt Tracker" },
      { name: "description", content: "Manage condominium / owners associations." },
    ],
  }),
  component: AssociationsPage,
});

type AssocRow = {
  id: string;
  name: string;
  address: string | null;
  notes: string | null;
  keywords: string[];
};

function AssociationsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["associations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("associations")
        .select("id,name,address,notes,keywords")
        .order("name");
      if (error) throw error;
      return data as AssocRow[];
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const upsert = useMutation({
    mutationFn: async (row: Partial<AssocRow> & { id?: string }) => {
      if (row.id) {
        const { error } = await supabase
          .from("associations")
          .update({
            name: row.name!,
            address: row.address ?? null,
            notes: row.notes ?? null,
            keywords: row.keywords ?? [],
          })
          .eq("id", row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("associations").insert({
          name: row.name!,
          address: row.address ?? null,
          notes: row.notes ?? null,
          keywords: row.keywords ?? [],
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["associations"] });
      setEditingId(null);
      setAdding(false);
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("associations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["associations"] });
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
            <h1 className="text-2xl font-bold">Owners Associations</h1>
            <p className="text-sm text-muted-foreground">
              Add keywords (supplier names, addresses, building names) so the AI can auto-assign expenses correctly.
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
            {data.map((a) =>
              editingId === a.id ? (
                <EditCard
                  key={a.id}
                  initial={a}
                  onCancel={() => setEditingId(null)}
                  onSave={(row) => upsert.mutate({ ...row, id: a.id })}
                  saving={upsert.isPending}
                />
              ) : (
                <Card key={a.id} className="p-4 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold">{a.name}</h3>
                    {a.address && (
                      <p className="text-sm text-muted-foreground">{a.address}</p>
                    )}
                    {a.keywords?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {a.keywords.map((k) => (
                          <span
                            key={k}
                            className="text-xs bg-secondary text-secondary-foreground rounded px-2 py-0.5"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    )}
                    {a.notes && (
                      <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
                        {a.notes}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setEditingId(a.id)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Delete "${a.name}"? Linked expenses will be kept but unassigned.`)) {
                          del.mutate(a.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ),
            )}
          </div>
        ) : (
          !adding && (
            <Card className="p-8 text-center text-muted-foreground">
              No associations yet. Add one to get started.
            </Card>
          )
        )}
      </main>
    </div>
  );
}

function EditCard({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: AssocRow;
  onSave: (row: { name: string; address: string | null; notes: string | null; keywords: string[] }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [keywords, setKeywords] = useState((initial?.keywords ?? []).join(", "));

  return (
    <Card className="p-4 mb-3 space-y-3">
      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Via Roma 12 Condominium" />
      </div>
      <div>
        <Label>Address</Label>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" />
      </div>
      <div>
        <Label>Keywords (comma-separated)</Label>
        <Input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="e.g. Enel, Acea, Via Roma 12"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Used by AI to match receipts to this association.
        </p>
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
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
              address: address.trim() || null,
              notes: notes.trim() || null,
              keywords: keywords
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        >
          <Save className="h-4 w-4 mr-1" /> Save
        </Button>
      </div>
    </Card>
  );
}