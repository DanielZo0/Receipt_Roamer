import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-10">
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
      </main>
    </div>
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

  return (
    <Card className="overflow-x-auto">
      <div className="flex items-center gap-2 p-4 border-b">
        <Input
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          className="max-w-xs"
        />
        <Button onClick={handleAdd} disabled={add.isPending}>
          Add
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                Loading…
              </TableCell>
            </TableRow>
          ) : !rows || rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                No allowed senders — inbound emails will be rejected until one is added.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => {
              const isLast = rows.length === 1;
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm">{r.email}</TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={isLast}
                      title={isLast ? "At least one allowed sender is required" : "Remove"}
                      onClick={() => {
                        if (confirm(`Remove ${r.email}?`)) del.mutate(r.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
