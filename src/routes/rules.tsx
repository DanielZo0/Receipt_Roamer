import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AppShell } from "@/components/AppShell";
import { RuleConditionRow } from "@/components/rules/rule-condition-row";
import { RuleActionRow } from "@/components/rules/rule-action-row";
import { RulePreview } from "@/components/rules/rule-preview";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2, Pencil, Plus, X, Save, ArrowUp, ArrowDown } from "lucide-react";
import {
  summarizeRule,
  type RuleAction,
  type RuleCondition,
} from "@/lib/extraction/rule-engine";

export const Route = createFileRoute("/rules")({
  head: () => ({
    meta: [
      { title: "Automation Rules · Receipt Tracker" },
      {
        name: "description",
        content: "If-this-then-that rules applied automatically to incoming receipts.",
      },
    ],
  }),
  component: RulesPage,
});

type RuleRow = {
  id: string;
  name: string | null;
  active: boolean;
  priority: number;
  conditions: RuleCondition[];
  actions: RuleAction[];
  created_at: string;
};

type Association = { id: string; name: string };

function RulesPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: associations } = useQuery({
    queryKey: ["associations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("associations").select("id,name").order("name");
      if (error) throw error;
      return data as Association[];
    },
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("name").order("name");
      if (error) throw error;
      return (data ?? []).map((c) => c.name) as string[];
    },
  });

  const { data: senderEmails } = useQuery({
    queryKey: ["allowed-sender-emails"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allowed_sender_emails")
        .select("email")
        .order("email");
      if (error) throw error;
      return (data ?? []).map((r) => r.email) as string[];
    },
  });

  const { data: rules, isLoading } = useQuery({
    queryKey: ["rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rules")
        .select("id, name, active, priority, conditions, actions, created_at")
        .order("priority", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as RuleRow[];
    },
  });

  const { data: notifications } = useQuery({
    queryKey: ["rule-notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rule_notifications")
        .select("id, message, read, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as { id: string; message: string; read: boolean; created_at: string }[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (row: {
      id?: string;
      name: string | null;
      conditions: RuleCondition[];
      actions: RuleAction[];
    }) => {
      if (row.id) {
        const { error } = await supabase
          .from("rules")
          .update({
            name: row.name,
            conditions: row.conditions as never,
            actions: row.actions as never,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("rules").insert({
          name: row.name,
          conditions: row.conditions as never,
          actions: row.actions as never,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      setAdding(false);
      setEditingId(null);
      toast.success("Rule saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("rules").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      toast.success("Rule deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("rule_notifications")
        .update({ read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rule-notifications"] }),
  });

  const reorder = useMutation({
    mutationFn: async (newOrder: RuleRow[]) => {
      const updates = newOrder
        .map((r, idx) => ({ id: r.id, priority: idx, changed: r.priority !== idx }))
        .filter((u) => u.changed);
      for (const u of updates) {
        const { error } = await supabase.from("rules").update({ priority: u.priority }).eq("id", u.id);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  function moveRule(index: number, direction: -1 | 1) {
    if (!rules) return;
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    const reordered = [...rules];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    reorder.mutate(reordered);
  }

  const assocName = (id: string) => associations?.find((a) => a.id === id)?.name ?? id;

  return (
    <AppShell maxWidth="4xl">
      <div className="space-y-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Automation Rules</h1>
            <p className="text-sm text-muted-foreground">
              If-this-then-that rules applied automatically while receipts are processed, before the
              AI's own guess is used.
            </p>
          </div>
          {!adding && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4 mr-1" /> New rule
            </Button>
          )}
        </div>

        {adding && (
          <RuleEditCard
            associations={associations ?? []}
            categories={categories ?? []}
            senderEmails={senderEmails ?? []}
            onCancel={() => setAdding(false)}
            onSave={(row) => upsert.mutate(row)}
            saving={upsert.isPending}
          />
        )}

        <section>
          {isLoading ? (
            <p className="text-center text-muted-foreground py-8">Loading…</p>
          ) : !rules || rules.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              No rules yet. Create one above, or correct an expense on the Expenses page and choose
              "Save rule".
            </Card>
          ) : (
            <div className="space-y-3">
              {rules.map((r, index) =>
                editingId === r.id ? (
                  <RuleEditCard
                    key={r.id}
                    initial={r}
                    associations={associations ?? []}
                    categories={categories ?? []}
                    senderEmails={senderEmails ?? []}
                    onCancel={() => setEditingId(null)}
                    onSave={(row) => upsert.mutate({ ...row, id: r.id })}
                    saving={upsert.isPending}
                  />
                ) : (
                  <Card key={r.id} className="p-4">
                    <div className="hidden md:flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium">{r.name ?? "Unnamed rule"}</p>
                        <p className="text-sm text-muted-foreground font-mono truncate">
                          {summarizeRule(r, { associationName: assocName })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={index === 0}
                          onClick={() => moveRule(index, -1)}
                          title="Move up in priority"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={index === rules.length - 1}
                          onClick={() => moveRule(index, 1)}
                          title="Move down in priority"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Switch
                          checked={r.active}
                          onCheckedChange={(checked) =>
                            toggleActive.mutate({ id: r.id, active: checked })
                          }
                        />
                        <Button size="icon" variant="ghost" onClick={() => setEditingId(r.id)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {r.name ?? "This rule"} will stop running against incoming receipts.
                                This can't be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => del.mutate(r.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                    <div className="md:hidden space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{r.name ?? "Unnamed rule"}</p>
                        <Switch
                          checked={r.active}
                          onCheckedChange={(checked) =>
                            toggleActive.mutate({ id: r.id, active: checked })
                          }
                        />
                      </div>
                      <p className="text-sm text-muted-foreground font-mono">
                        {summarizeRule(r, { associationName: assocName })}
                      </p>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={index === 0}
                          onClick={() => moveRule(index, -1)}
                          title="Move up in priority"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={index === rules.length - 1}
                          onClick={() => moveRule(index, 1)}
                          title="Move down in priority"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditingId(r.id)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {r.name ?? "This rule"} will stop running against incoming receipts.
                                This can't be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => del.mutate(r.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </Card>
                ),
              )}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Recent notifications
          </h2>
          {!notifications || notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rule notifications yet.</p>
          ) : (
            <div className="space-y-2">
              {notifications.map((n) => (
                <Card
                  key={n.id}
                  className={`p-3 flex items-center justify-between gap-3 ${n.read ? "opacity-60" : ""}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm truncate">{n.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </div>
                  {!n.read && (
                    <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)}>
                      Mark read
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

// ─── Rule builder ───────────────────────────────────────────────────────────

function emptyCondition(): RuleCondition {
  return { field: "supplier", operator: "contains", value: "" };
}

function emptyAction(): RuleAction {
  return { type: "set_category", value: "" };
}

function RuleEditCard({
  initial,
  associations,
  categories,
  senderEmails,
  onSave,
  onCancel,
  saving,
}: {
  initial?: RuleRow;
  associations: Association[];
  categories: string[];
  senderEmails: string[];
  onSave: (row: {
    name: string | null;
    conditions: RuleCondition[];
    actions: RuleAction[];
  }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [conditions, setConditions] = useState<RuleCondition[]>(
    initial?.conditions?.length ? initial.conditions : [emptyCondition()],
  );
  const [actions, setActions] = useState<RuleAction[]>(
    initial?.actions?.length ? initial.actions : [emptyAction()],
  );

  function updateCondition(i: number, patch: Partial<RuleCondition>) {
    setConditions((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function updateAction(i: number, patch: Partial<RuleAction>) {
    setActions((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }

  const valid =
    conditions.every((c) => String(c.value).trim().length > 0) &&
    actions.every(
      (a) =>
        a.type === "flag_for_review" ||
        a.type === "notify" ||
        String(a.value ?? "").trim().length > 0,
    );

  return (
    <Card className="p-4 mb-3 space-y-4">
      <div>
        <Label>Name (optional)</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Flag large lift invoices"
        />
      </div>

      <div className="space-y-2">
        <Label>If (all conditions must match)</Label>
        {conditions.map((c, i) => (
          <RuleConditionRow
            key={i}
            condition={c}
            associations={associations}
            senderEmails={senderEmails}
            onChange={(patch) => updateCondition(i, patch)}
            onRemove={() => setConditions((prev) => prev.filter((_, idx) => idx !== i))}
            removable={conditions.length > 1}
          />
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConditions((prev) => [...prev, emptyCondition()])}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add condition
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Then</Label>
        {actions.map((a, i) => (
          <RuleActionRow
            key={i}
            action={a}
            associations={associations}
            categories={categories}
            onChange={(patch) => updateAction(i, patch)}
            onRemove={() => setActions((prev) => prev.filter((_, idx) => idx !== i))}
            removable={actions.length > 1}
          />
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setActions((prev) => [...prev, emptyAction()])}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add action
        </Button>
      </div>

      <RulePreview conditions={conditions} />

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          <X className="h-4 w-4 mr-1" /> Cancel
        </Button>
        <Button
          disabled={!valid || saving}
          onClick={() => onSave({ name: name.trim() || null, conditions, actions })}
        >
          <Save className="h-4 w-4 mr-1" /> Save
        </Button>
      </div>
    </Card>
  );
}
