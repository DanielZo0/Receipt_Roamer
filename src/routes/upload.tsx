import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppNav } from "@/components/AppNav";
import { supabase } from "@/integrations/supabase/client";
import { extractAndSaveExpense } from "@/lib/expenses.functions";
import { toast } from "sonner";
import {
  Upload as UploadIcon,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  PlusCircle,
  FileText,
  Image,
  Mail,
  Copy,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";

interface LedgerLineRow {
  id: string;
  supplier: string | null;
  amount: number | null;
  association_id: string | null;
}

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload receipts · Receipt Tracker" },
      { name: "description", content: "Upload receipts or bills and extract their data automatically — supports batch uploading multiple files at once." },
    ],
  }),
  component: UploadPage,
});

type FileStatus = "queued" | "uploading" | "extracting" | "done" | "error";

interface QueuedFile {
  id: string;
  file: File;
  status: FileStatus;
  savedIds?: string[];
  ledgerGroupId?: string | null;
  totalMismatch?: { grandTotal: number; sumOfLineItems: number } | null;
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

const MAX_CONCURRENCY = 3;
const MAX_FILE_SIZE = 15 * 1024 * 1024;

function StatusChip({
  status,
  error,
  savedCount,
}: {
  status: FileStatus;
  error?: string;
  savedCount?: number;
}) {
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
        <CheckCircle2 className="h-3 w-3" />
        {savedCount && savedCount > 1 ? `Saved ${savedCount} line items` : "Saved"}
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

function FileIcon({ mime }: { mime: string }) {
  if (mime.startsWith("image/")) return <Image className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
  return <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
}

function LedgerAwareQueueRow({ entry }: { entry: QueuedFile }) {
  const [open, setOpen] = useState(false);
  const isLedger = entry.status === "done" && (entry.savedIds?.length ?? 0) > 1;

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3">
        <FileIcon mime={entry.file.type} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{entry.file.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatBytes(entry.file.size)}
            {entry.status === "error" && entry.error && (
              <span className="ml-2 text-destructive">{entry.error}</span>
            )}
          </p>
        </div>
        <StatusChip status={entry.status} error={entry.error} savedCount={entry.savedIds?.length} />
        {isLedger && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Toggle line item review"
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>
      {isLedger && entry.totalMismatch && (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Line items sum to {entry.totalMismatch.sumOfLineItems.toFixed(2)} but the document
            states a total of {entry.totalMismatch.grandTotal.toFixed(2)} — please review below.
          </span>
        </div>
      )}
      {isLedger && open && <LedgerLineItemsReview expenseIds={entry.savedIds ?? []} />}
    </div>
  );
}

function LedgerLineItemsReview({ expenseIds }: { expenseIds: string[] }) {
  const { data: associations } = useQuery({
    queryKey: ["associations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("associations").select("id,name").order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const { data: lines, refetch } = useQuery({
    queryKey: ["ledger-line-items", expenseIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("id, supplier, amount, association_id")
        .in("id", expenseIds)
        .order("source_line_index", { ascending: true });
      if (error) throw error;
      return data as LedgerLineRow[];
    },
    enabled: expenseIds.length > 0,
  });

  async function updateLine(id: string, patch: Partial<LedgerLineRow>) {
    const { error } = await supabase.from("expenses").update(patch).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    refetch();
  }

  return (
    <div className="mx-4 mb-3 border rounded-md divide-y">
      {(lines ?? []).map((line) => (
        <div key={line.id} className="flex items-center gap-2 px-3 py-2">
          <span className="flex-1 min-w-0 text-sm truncate" title={line.supplier ?? ""}>
            {line.supplier || "—"}
          </span>
          <Input
            type="number"
            step="0.01"
            defaultValue={line.amount ?? ""}
            onBlur={(ev) => {
              const v = ev.target.value ? Number(ev.target.value) : null;
              if (v !== line.amount) updateLine(line.id, { amount: v });
            }}
            className="w-24"
          />
          <Select
            value={line.association_id ?? "none"}
            onValueChange={(v) => updateLine(line.id, { association_id: v === "none" ? null : v })}
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
        </div>
      ))}
    </div>
  );
}

function UploadPage() {
  const navigate = useNavigate();
  const extractFn = useServerFn(extractAndSaveExpense);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const processingRef = useRef(new Set<string>());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateFile = useCallback((id: string, patch: Partial<QueuedFile>) => {
    setQueue((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const processFile = useCallback(
    async (entry: QueuedFile) => {
      const { file, id } = entry;

      if (file.size > MAX_FILE_SIZE) {
        updateFile(id, { status: "error", error: "File too large (max 15 MB)" });
        processingRef.current.delete(id);
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
        const saved = await extractFn({
          data: {
            file_path: path,
            file_name: file.name,
            file_size: file.size,
            file_mime: file.type,
            file_base64: b64,
          },
        });
        updateFile(id, {
          status: "done",
          savedIds: saved?.expenses?.map((e) => e.id) ?? [],
          ledgerGroupId: saved?.ledgerGroupId ?? null,
          totalMismatch: saved?.totalMismatch ?? null,
        });
      } catch (e) {
        const msg = (e as Error).message || "Upload failed";
        updateFile(id, { status: "error", error: msg });
      } finally {
        processingRef.current.delete(id);
      }
    },
    [extractFn, updateFile],
  );

  // Drain the queue with bounded concurrency (max MAX_CONCURRENCY simultaneous)
  const drainQueue = useCallback(
    (newQueue: QueuedFile[]) => {
      const queued = newQueue.filter(
        (f) => f.status === "queued" && !processingRef.current.has(f.id),
      );
      const available = MAX_CONCURRENCY - processingRef.current.size;
      const toStart = queued.slice(0, Math.max(0, available));
      for (const entry of toStart) {
        processingRef.current.add(entry.id);
        // When one finishes, kick off the next from whatever is still queued
        processFile(entry).finally(() => {
          setQueue((current) => {
            const stillQueued = current.filter(
              (f) => f.status === "queued" && !processingRef.current.has(f.id),
            );
            if (stillQueued.length > 0) {
              const next = stillQueued[0];
              processingRef.current.add(next.id);
              processFile(next);
            }
            return current;
          });
        });
      }
    },
    [processFile],
  );

  function addFiles(files: File[]) {
    const newEntries: QueuedFile[] = files.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      status: "queued",
    }));
    setQueue((prev) => {
      const updated = [...prev, ...newEntries];
      drainQueue(updated);
      return updated;
    });
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
    // Reset so same file can be re-selected
    e.target.value = "";
  }

  const doneCount = queue.filter((f) => f.status === "done").length;
  const failCount = queue.filter((f) => f.status === "error").length;
  const activeCount = queue.filter(
    (f) => f.status === "uploading" || f.status === "extracting",
  ).length;
  const allFinished = queue.length > 0 && activeCount === 0 && queue.every((f) => f.status === "done" || f.status === "error");

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-1">Upload receipts</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Drop one or more images or PDFs. AI will extract date, supplier, amount, and pick the best matching association.
        </p>

        {/* Drop zone */}
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
          aria-label="Upload receipts drop zone"
        >
          <UploadIcon className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            Drag files here, or click to choose
          </p>
          <p className="text-xs text-muted-foreground">
            Images &amp; PDFs · Up to 15 MB each · Multiple files supported
          </p>
          <input
            ref={fileInputRef}
            id="file-input"
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={handleInput}
          />
        </Card>

        {/* Email inbound panel */}
        <EmailInboundPanel />

        {/* Queue list */}
        {queue.length > 0 && (
          <Card className="divide-y mb-4">
            {queue.map((entry) => (
              <LedgerAwareQueueRow key={entry.id} entry={entry} />
            ))}
          </Card>
        )}

        {/* Summary bar */}
        {queue.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              {activeCount > 0 && (
                <span className="mr-3 inline-flex items-center gap-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {activeCount} processing…
                </span>
              )}
              <span className="font-medium text-foreground">{doneCount}/{queue.length} saved</span>
              {failCount > 0 && (
                <span className="ml-2 text-destructive">· {failCount} failed</span>
              )}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="gap-1"
              >
                <PlusCircle className="h-3.5 w-3.5" /> Add more
              </Button>
              {allFinished && (
                <Button size="sm" onClick={() => navigate({ to: "/expenses" })}>
                  View expenses
                </Button>
              )}
            </div>
          </div>
        )}

        {allFinished && (
          <p className="text-xs text-muted-foreground mt-2 text-right">
            See full history on the{" "}
            <Link to="/upload-logs" className="underline">upload logs</Link> page.
          </p>
        )}
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
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Mail className="h-4 w-4 text-primary" />
          Or send receipts by email
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {/* Expandable body */}
      {open && (
        <div className="border-t px-4 py-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Forward any email containing receipt image(s) or PDF attachment(s) to the address
            below. AI will extract and save each one automatically — only emails sent from{" "}
            <span className="font-medium text-foreground">danzammit1@gmail.com</span> are
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
            Supported formats: JPEG, PNG, WEBP, HEIC, TIFF, GIF, PDF · Max 15 MB per
            attachment · Results appear in{" "}
            <Link to="/upload-logs" className="underline">
              Upload logs
            </Link>
            .
          </p>
        </div>
      )}
    </Card>
  );
}