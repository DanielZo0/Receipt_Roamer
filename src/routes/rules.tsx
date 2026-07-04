import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/rules")({
  head: () => ({
    meta: [
      { title: "Learned Rules · Receipt Tracker" },
      { name: "description", content: "Rules learned from manual association corrections." },
    ],
  }),
  component: RulesPage,
});

type RuleRow = {
  id: string;
  supplier_pattern: string;
  association_id: string;
  active: boolean;
  created_at: string;
};

function RulesPage() {
  const qc = useQueryClient();

  const { data: associations } = useQuery({
    queryKey: ["associations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("associations").select("id,name").order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const { data: rules, isLoading } = useQuery({
    queryKey: ["association-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("association_rules")
        .select("id, supplier_pattern, association_id, active, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as RuleRow[];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("association_rules").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["association-rules"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("association_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["association-rules"] });
      toast.success("Rule deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assocName = (id: string) => associations?.find((a) => a.id === id)?.name ?? "—";

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Learned Rules</h1>
          <p className="text-sm text-muted-foreground">
            Rules saved from manual association corrections on the Expenses page. Active rules are applied
            automatically before the AI is asked to guess.
          </p>
        </div>

        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier contains</TableHead>
                <TableHead>Association</TableHead>
                <TableHead>Active</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : !rules || rules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No rules yet. Correct an expense's association on the Expenses page and choose "Save rule".
                  </TableCell>
                </TableRow>
              ) : (
                rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.supplier_pattern}</TableCell>
                    <TableCell>{assocName(r.association_id)}</TableCell>
                    <TableCell>
                      <Switch
                        checked={r.active}
                        onCheckedChange={(checked) => toggleActive.mutate({ id: r.id, active: checked })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("Delete this rule?")) del.mutate(r.id);
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
