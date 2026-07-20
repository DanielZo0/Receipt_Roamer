import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useRef, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { AppNav } from "@/components/AppNav";
import { supabase } from "@/integrations/supabase/client";
import { extractAndSaveIncomePayment } from "@/lib/income.functions";
import { toast } from "sonner";
import {
  Upload as UploadIcon,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Image,
  FileText,
  ExternalLink,
  Mail,
  Copy,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export const Route = createFileRoute("/income")({
  head: () => ({
    meta: [
      { title: "Income · Receipt Tracker" },
      { name: "description", content: "Upload owner payment screenshots and match them to owners automatically." },
    ],
  }),
  component: IncomePage,
});

type FileStatus = "queued" | "uploading" | "extracting" | "done" | "error";

interface QueuedFile {
  id: string;
  file: File;
  status: FileStatus;
  error?: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      resolve(s.split(",")[1] ?? "");
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_FILE_SIZE = 15 * 1024 * 1024;

function StatusChip({ status, error }: { status: FileStatus; error?: string }) {
  if (status === "queued")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
        <Clock className="h-3 w-3" /> Queued
      </span>
    );
  if (status === "uploading")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Uploading
      </span>
    );
  if (status === "extracting")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Extracting
      </span>
    );
  if (status === "done")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-3 w-3" /> Saved
      </span>
    );
  return (
    <span
      title={error}
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive"
    >
      <XCircle className="h-3 w-3" /> Failed
    </span>
  );
}

type OwnerLite = { id: string; name: string; apartment: string | null; condominium_id: string | null };
type PaymentRow = {
  id: string;
  owner_id: string | null;
  condominium_id: string | null;
  payer_name: string | null;
  amount: number | null;
  currency: string | null;
  payment_date: string | null;
  reference_string: string | null;
  match_confidence: number | null;
  match_signals: string[] | null;
  file_path: string | null;
  created_at: string;
};

function IncomePage() {
  const qc = useQueryClient();
  const extractFn = useServerFn(extractAndSaveIncomePayment);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: owners } = useQuery({
    queryKey: ["owners"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("owners")
        .select("id,name,apartment,condominium_id")
        .order("name");
      if (error) throw error;
      return data as OwnerLite[];
    },
  });

  const { data: associations } = useQuery({
    queryKey: ["associations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("associations").select("id,name").order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const { data: payments, isLoading } = useQuery({
    queryKey: ["income_payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("income_payments")
        .select("*")
        .order("payment_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PaymentRow[];
    },
  });

  const ownerName = (id: string | null) => (id ? owners?.find((o) => o.id === id)?.name ?? "—" : "—");
  const condoName = (id: string | null) => (id ? associations?.find((a) => a.id === id)?.name ?? "—" : "—");

  const update = useMutation({
    mutationFn: async (row: Partial<PaymentRow> & { id: string }) => {
      const { id, ...rest } = row;
      if (rest.owner_id) {
        const owner = owners?.find((o) => o.id === rest.owner_id);
        (rest as Partial<PaymentRow>).condominium_id = owner?.condominium_id ?? null;
      }
      const { error } = await supabase.from("income_payments").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["income_payments"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateFile = useCallback((id: string, patch: Partial<QueuedFile>) => {
    setQueue((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const processFile = useCallback(
    async (entry: QueuedFile) => {
      const { file, id } = entry;
      if (file.size > MAX_FILE_SIZE) {
        updateFile(id, { status: "error", error: "File too large (max 15 MB)" });
        return;
      }
      try {
        updateFile(id, { status: "uploading" });
        const path = `${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
        const { error: upErr } = await supabase.storage
          .from("receipts")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;

        updateFile(id, { status: "extracting" });
        const b64 = await fileToBase64(file);
        await extractFn({
          data: {
            file_path: path,
            file_name: file.name,
            file_size: file.size,
            file_mime: file.type,
            file_base64: b64,
          },
        });
        updateFile(id, { status: "done" });
        qc.invalidateQueries({ queryKey: ["income_payments"] });
        qc.invalidateQueries({ queryKey: ["owners"] });
      } catch (e) {
        updateFile(id, { status: "error", error: (e as Error).message || "Upload failed" });
      }
    },
    [extractFn, updateFile, qc],
  );

  function addFiles(files: File[]) {
    const newEntries: QueuedFile[] = files.map((f) => ({ id: crypto.randomUUID(), file: f, status: "queued" }));
    setQueue((prev) => [...prev, ...newEntries]);
    for (const entry of newEntries) {
      updateFile(entry.id, { status: "uploading" });
      processFile(entry);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) addFiles(files);
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) addFiles(files);
    e.target.value = "";
  }

  async function openFile(path: string | null) {
    if (!path) return;
    const { data, error } = await supabase.storage.from("receipts").createSignedUrl(path, 60 * 5);
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
        <h1 className="text-2xl font-bold mb-1">Income</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Upload owner payment screenshots (e.g. Wise transfer confirmations). AI will extract the
          payer, amount, and reference, and match it to an owner.
        </p>

        <Card
          className={`p-8 border-2 border-dashed text-center transition-colors cursor-pointer mb-4 ${
            dragOver ? "border-primary bg-accent" : "border-border hover:border-primary/50"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          aria-label="Upload payment screenshots drop zone"
        >
          <UploadIcon className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-3">Drag payment screenshots here, or click to choose</p>
          <p className="text-xs text-muted-foreground">Images · Up to 15 MB each · Multiple files supported</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleInput}
          />
        </Card>

        {/* Email inbound panel */}
        <EmailInboundPanel />

        {queue.length > 0 && (
          <Card className="divide-y mb-6">
            {queue.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                {entry.file.type.startsWith("image/") ? (
                  <Image className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{entry.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(entry.file.size)}
                    {entry.status === "error" && entry.error && (
                      <span className="ml-2 text-destructive">{entry.error}</span>
                    )}
                  </p>
                </div>
                <StatusChip status={entry.status} error={entry.error} />
              </div>
            ))}
          </Card>
        )}

        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Payer</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Condo</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>File</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : !payments || payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No income payments yet.
                  </TableCell>
                </TableRow>
              ) : (
                payments.map((p) => (
                  <TableRow key={p.id} className={!p.owner_id ? "bg-amber-500/5" : undefined}>
                    <TableCell className="whitespace-nowrap">{p.payment_date ?? "—"}</TableCell>
                    <TableCell>{p.payer_name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {p.amount != null ? `${p.amount.toFixed(2)} ${p.currency ?? ""}` : "—"}
                    </TableCell>
                    <TableCell className="max-w-48 truncate" title={p.reference_string ?? ""}>
                      {p.reference_string ?? "—"}
                    </TableCell>
                    <TableCell>{condoName(p.condominium_id)}</TableCell>
                    <TableCell>
                      <Select
                        value={p.owner_id ?? "none"}
                        onValueChange={(v) => update.mutate({ id: p.id, owner_id: v === "none" ? null : v })}
                      >
                        <SelectTrigger className="min-w-44">
                          <SelectValue>{ownerName(p.owner_id)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— unassigned —</SelectItem>
                          {owners?.map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              {o.name}{o.apartment ? ` (Flt ${o.apartment})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {p.match_confidence != null ? (
                        <Badge variant={p.owner_id ? "outline" : "destructive"}>
                          {(p.match_confidence * 100).toFixed(0)}%
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {p.file_path ? (
                        <Button size="icon" variant="ghost" onClick={() => openFile(p.file_path)}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      ) : (
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      )}
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

// ── Email inbound helper panel ───────────────────────────────────────────────

const INBOUND_EMAIL = import.meta.env.VITE_INBOUND_EMAIL as string | undefined;

function EmailInboundPanel() {
  const [open, setOpen] = useState(false);

  if (!INBOUND_EMAIL) return null;

  async function copyAddress() {
    await navigator.clipboard.writeText(INBOUND_EMAIL!);
    toast.success("Email address copied!");
  }

  return (
    <Card className="mb-4 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Mail className="h-4 w-4 text-primary" />
          Or send payment screenshots by email
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t px-4 py-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Forward a payment confirmation screenshot to the address below, with{" "}
            <span className="font-medium text-foreground">"income"</span> or{" "}
            <span className="font-medium text-foreground">"payment"</span> somewhere in the email
            subject line — that's how it's told apart from a regular expense receipt. Only emails
            sent from <span className="font-medium text-foreground">danzammit1@gmail.com</span> are
            processed.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm font-mono truncate select-all">
              {INBOUND_EMAIL}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="flex-shrink-0 gap-1.5"
              onClick={copyAddress}
              title="Copy email address"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Example subject: "Income: May contribution". Without one of those keywords in the
            subject, the attachment is processed as a regular expense receipt instead.
          </p>
        </div>
      )}
    </Card>
  );
}
