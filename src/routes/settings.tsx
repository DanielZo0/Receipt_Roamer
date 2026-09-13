import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppShell } from "@/components/AppShell";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · Receipt Tracker" },
      { name: "description", content: "Manage senders allowed to forward receipts and income emails." },
    ],
  }),
  component: SettingsPage,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AllowedSenderRow = {
  id: string;
  email: string;
  created_at: string;
};

function SettingsPage() {
  return (
    <AppShell maxWidth="4xl">
      <div className="space-y-10">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage which email addresses are allowed to forward receipts and income emails into the
            inbound-email pipeline.
          </p>
        </div>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Allowed sender emails
          </h2>
          <AllowedSendersTable />
        </section>
      </div>
    </AppShell>
  );
}

function AllowedSendersTable() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["allowed-sender-emails"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allowed_sender_emails")
        .select("id, email, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as AllowedSenderRow[];
    },
  });

  const add = useMutation({
    mutationFn: async (value: string) => {
      const { error } = await supabase.from("allowed_sender_emails").insert({ email: value });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["allowed-sender-emails"] });
      toast.success("Sender added");
      setEmail("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("allowed_sender_emails").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["allowed-sender-emails"] });
      toast.success("Sender removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleAdd = () => {
    const value = email.toLowerCase().trim();
    if (!EMAIL_RE.test(value)) {
      toast.error("Enter a valid email address");
      return;
    }
    add.mutate(value);
  };

  const columns: DataTableColumn<AllowedSenderRow>[] = [
    { key: "email", header: "Email", cell: (r) => <span className="font-mono text-sm">{r.email}</span> },
  ];

  return (
    <>
      <div className="flex items-center gap-2 p-4 border rounded-lg mb-4 flex-wrap bg-card">
        <Input
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          className="max-w-xs flex-1 min-w-0"
        />
        <Button onClick={handleAdd} disabled={add.isPending}>
          Add
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        isLoading={isLoading}
        emptyMessage="No allowed senders — inbound emails will be rejected until one is added."
        rowActions={(r) => {
          const isLast = (rows?.length ?? 0) === 1;
          return (
            <ConfirmDeleteButton
              title={`Remove ${r.email}?`}
              description="Emails from this address will no longer be accepted by the inbound-email pipeline."
              confirmLabel="Remove"
              disabled={isLast}
              disabledReason="At least one allowed sender is required"
              triggerTitle="Remove"
              onConfirm={() => del.mutate(r.id)}
            />
          );
        }}
      />
    </>
  );
}
