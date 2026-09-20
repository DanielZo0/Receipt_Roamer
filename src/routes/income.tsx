import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useRef, useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { AppShell } from "@/components/AppShell";
import { OwnerCombobox, type OwnerLite, type AssociationLite } from "@/components/OwnerCombobox";
import { MobileCardList } from "@/components/ui/responsive-table";
import { PaymentMobileCard } from "@/components/income/payment-mobile-card";
import { PaymentTableRow } from "@/components/income/payment-table-row";
import {
  PAYMENT_EDITABLE_FIELDS,
  type AllocationDraft,
  type AllocationRow,
  type PaymentRow,
  draftFromRow,
} from "@/lib/income-types";
import { needsAttention } from "@/lib/income-allocations";
import { formatIsoDateDmy } from "@/lib/format";
import { draftIsUnchanged, useRowEditor } from "@/lib/use-row-editor";
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
  Mail,
  Copy,
  ChevronDown,
  ChevronUp,
  Download,
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

function formatDateForFilename(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

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

/** Compare by content, never by AllocationDraft.key -- `key` holds the DB id
 *  for a loaded row but a fresh random UUID for an unsaved one, so it cannot
 *  tell the two apart. */
function allocationsUnchanged(original: AllocationRow[], draft: AllocationDraft[]): boolean {
  if (original.length !== draft.length) return false;
  return original.every((o, i) => {
    const d = draft[i];
    return (
      d.owner_id === o.owner_id &&
      d.condominium_id === o.condominium_id &&
      d.amount === o.amount
    );
  });
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

function IncomePage() {
  const qc = useQueryClient();
  const extractFn = useServerFn(extractAndSaveIncomePayment);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportNewOnly, setExportNewOnly] = useState(true);

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

  const { data: allocations } = useQuery({
    queryKey: ["income_payment_allocations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("income_payment_allocations")
        .select("*")
        .order("created_at");
      if (error) throw error;
      return data as AllocationRow[];
    },
  });

  const allocationsByPayment = useMemo(() => {
    const map = new Map<string, AllocationRow[]>();
    for (const a of allocations ?? []) {
      if (!map.has(a.payment_id)) map.set(a.payment_id, []);
      map.get(a.payment_id)!.push(a);
    }
    return map;
  }, [allocations]);

  const condoName = (id: string | null) => (id ? associations?.find((a) => a.id === id)?.name ?? "—" : "—");
  /** The payment's own condominium_id is only a mirror of the single-allocation
   *  case -- NULL for any split -- so derive the label from the allocations
   *  themselves, which is where the association actually lives now. */
  const condoNameForPayment = (p: PaymentRow, allocs: AllocationRow[]) => {
    const ids = [...new Set(allocs.map((a) => a.condominium_id).filter((id): id is string => !!id))];
    if (ids.length === 0) return condoName(p.condominium_id);
    if (ids.length === 1) return condoName(ids[0]);
    return `${ids.length} associations`;
  };

  const ownerName = (id: string | null) => (id ? owners?.find((o) => o.id === id)?.name ?? "—" : "—");

  const filteredPayments = useMemo(
    () =>
      (payments ?? []).filter(
        (p) => !showUnmatchedOnly || needsAttention(p.amount, allocationsByPayment.get(p.id) ?? []),
      ),
    [payments, showUnmatchedOnly, allocationsByPayment],
  );

  const editor = useRowEditor<PaymentRow>();

  const [allocationDraft, setAllocationDraft] = useState<AllocationDraft[]>([]);

  function startEdit(p: PaymentRow) {
    editor.start(p, PAYMENT_EDITABLE_FIELDS);
    setAllocationDraft((allocationsByPayment.get(p.id) ?? []).map(draftFromRow));
  }

  function cancelEdit() {
    editor.cancel();
    setAllocationDraft([]);
  }

  const assignOwner = useMutation({
    mutationFn: async ({
      payment,
      ownerId,
      existingAmount,
    }: {
      payment: PaymentRow;
      ownerId: string | null;
      existingAmount: number | null | undefined;
    }) => {
      const { error } = await supabase.rpc("set_payment_allocations", {
        p_payment_id: payment.id,
        p_allocations: ownerId
          ? [
              {
                owner_id: ownerId,
                condominium_id: null,
                // Keep an amount the user already recorded on this slice --
                // only a payment with no allocation at all takes the full total.
                amount: existingAmount === undefined ? payment.amount : existingAmount,
              },
            ]
          : [],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income_payments"] });
      qc.invalidateQueries({ queryKey: ["income_payment_allocations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkAssign = useMutation({
    mutationFn: async ({ ids, ownerId }: { ids: string[]; ownerId: string | null }) => {
      const byId = new Map((payments ?? []).map((p) => [p.id, p]));
      for (const id of ids) {
        const payment = byId.get(id);
        const { error } = await supabase.rpc("set_payment_allocations", {
          p_payment_id: id,
          p_allocations: ownerId
            ? [{ owner_id: ownerId, condominium_id: null, amount: payment?.amount ?? null }]
            : [],
        });
        if (error) throw error;
      }
    },
    onSuccess: (_data, { ids }) => {
      qc.invalidateQueries({ queryKey: ["income_payments"] });
      qc.invalidateQueries({ queryKey: ["income_payment_allocations"] });
      setSelected(new Set());
      toast.success(`Assigned ${ids.length} payment${ids.length === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => {
      qc.invalidateQueries({ queryKey: ["income_payments"] });
      qc.invalidateQueries({ queryKey: ["income_payment_allocations"] });
      toast.error(e.message);
    },
  });

  const markExported = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("income_payments")
        .update({ exported_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["income_payments"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const resetExported = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("income_payments").update({ exported_at: null }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_data, ids) => {
      qc.invalidateQueries({ queryKey: ["income_payments"] });
      toast.success(`Reset export status for ${ids.length} payment${ids.length === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (row: PaymentRow) => {
      if (row.file_path) {
        await supabase.storage.from("receipts").remove([row.file_path]);
      }
      const { error } = await supabase.from("income_payments").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income_payments"] });
      toast.success("Deleted");
    },
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

  const saveAllocations = useMutation({
    mutationFn: async ({
      payment,
      fields,
      allocations,
      originalAllocations,
    }: {
      payment: PaymentRow;
      fields: Partial<PaymentRow>;
      allocations: AllocationDraft[];
      originalAllocations: AllocationRow[];
    }) => {
      const scalarFields = { ...fields };
      delete scalarFields.owner_id; // owner now lives in allocations
      delete scalarFields.condominium_id; // and the mirror is set by the RPC

      if (!draftIsUnchanged(payment, scalarFields)) {
        const { error } = await supabase
          .from("income_payments")
          .update(scalarFields)
          .eq("id", payment.id);
        if (error) throw error;
      }

      if (!allocationsUnchanged(originalAllocations, allocations)) {
        const { error: rpcError } = await supabase.rpc("set_payment_allocations", {
          p_payment_id: payment.id,
          p_allocations: allocations
            .filter((a) => a.owner_id !== null || a.amount !== null)
            .map((a) => ({
              owner_id: a.owner_id,
              condominium_id: a.condominium_id,
              amount: a.amount,
            })),
        });
        if (rpcError) throw rpcError;
      }
    },
    onSuccess: (_data, variables) => {
      if (editor.editingId === variables.payment.id) cancelEdit();
      qc.invalidateQueries({ queryKey: ["income_payments"] });
      qc.invalidateQueries({ queryKey: ["income_payment_allocations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function saveRow(p: PaymentRow) {
    saveAllocations.mutate({
      payment: p,
      fields: editor.draft,
      allocations: allocationDraft,
      originalAllocations: allocationsByPayment.get(p.id) ?? [],
    });
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

  function exportCsv() {
    const toExport = exportNewOnly ? filteredPayments.filter((p) => !p.exported_at) : filteredPayments;
    if (toExport.length === 0) {
      toast.info("Nothing new to export");
      return;
    }
    const headers = [
      "Date",
      "Payer",
      "Payment Amount",
      "Allocated Amount",
      "Currency",
      "Reference",
      "Condo",
      "Owner",
    ];
    // A split payment occupies several rows that repeat the payment total, so
    // summing "Payment Amount" would double-count it. "Allocated Amount" is the
    // per-association figure. The column names are distinct for that reason.
    const rows = toExport.flatMap((p) => {
      const allocs = allocationsByPayment.get(p.id) ?? [];
      if (allocs.length === 0) {
        return [
          [
            p.payment_date ? formatIsoDateDmy(p.payment_date) : "",
            p.payer_name ?? "",
            p.amount?.toString() ?? "",
            "",
            p.currency ?? "",
            p.reference_string ?? "",
            condoName(p.condominium_id),
            "",
          ],
        ];
      }
      return allocs.map((a) => [
        p.payment_date ? formatIsoDateDmy(p.payment_date) : "",
        p.payer_name ?? "",
        p.amount?.toString() ?? "",
        a.amount?.toString() ?? "",
        p.currency ?? "",
        p.reference_string ?? "",
        condoName(a.condominium_id),
        ownerName(a.owner_id),
      ]);
    });
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `income-${formatDateForFilename(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    if (exportNewOnly) {
      markExported.mutate(toExport.map((p) => p.id));
    }
  }

  return (
    <AppShell maxWidth="6xl">
        <h1 className="text-2xl font-bold mb-1">Income</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Upload owner payment screenshots (e.g. Wise transfer confirmations). AI will extract the
          payer, amount, and reference, and match it to an owner.
        </p>

        <Card
          className={`p-6 sm:p-8 min-h-[160px] sm:min-h-[200px] flex flex-col items-center justify-center border-2 border-dashed text-center transition-colors cursor-pointer mb-4 ${
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
          <p className="text-sm text-muted-foreground mb-3">Drag payment screenshots here, or tap to choose</p>
          <Button type="button" size="lg" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
            Browse files
          </Button>
          <p className="text-xs text-muted-foreground mt-3">Images · Up to 15 MB each · Multiple files supported</p>
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

        {(() => {
          const filtered = filteredPayments;
          const allVisibleSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));

          function toggleAll() {
            setSelected((prev) => {
              if (allVisibleSelected) return new Set();
              return new Set(filtered.map((p) => p.id));
            });
          }

          function toggleRow(id: string) {
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }

          const paymentProps = (p: PaymentRow) => ({
            payment: p,
            owners: (owners ?? []) as OwnerLite[],
            associations: (associations ?? []) as AssociationLite[],
            condoName: condoNameForPayment(p, allocationsByPayment.get(p.id) ?? []),
            selected: selected.has(p.id),
            onToggleSelect: () => toggleRow(p.id),
            isEditing: editor.isEditing(p.id),
            draft: editor.draft,
            onChange: editor.set,
            onEdit: () => startEdit(p),
            onCancel: cancelEdit,
            onSave: () => saveRow(p),
            saving: saveAllocations.isPending && editor.editingId === p.id,
            onAssignOwner: (ownerId: string | null) =>
              assignOwner.mutate({
                payment: p,
                ownerId,
                existingAmount: (allocationsByPayment.get(p.id) ?? [])[0]?.amount,
              }),
            onOpenFile: () => openFile(p.file_path),
            onDelete: () => del.mutate(p),
            allocations: allocationsByPayment.get(p.id) ?? [],
            allocationDraft,
            onAllocationChange: setAllocationDraft,
            ownerName,
          });

          return (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="inline-flex rounded-md border p-0.5 bg-muted/40">
                  <button
                    type="button"
                    onClick={() => setShowUnmatchedOnly(false)}
                    className={`px-3 py-1 rounded-sm text-sm font-medium transition-colors ${
                      !showUnmatchedOnly ? "bg-background shadow-sm" : "text-muted-foreground"
                    }`}
                  >
                    All ({payments?.length ?? 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowUnmatchedOnly(true)}
                    className={`px-3 py-1 rounded-sm text-sm font-medium transition-colors ${
                      showUnmatchedOnly ? "bg-background shadow-sm" : "text-muted-foreground"
                    }`}
                  >
                    Needs attention (
                    {payments?.filter((p) =>
                      needsAttention(p.amount, allocationsByPayment.get(p.id) ?? []),
                    ).length ?? 0}
                    )
                  </button>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox checked={exportNewOnly} onCheckedChange={(v) => setExportNewOnly(v === true)} />
                    Only new (not yet exported)
                  </label>
                  {!exportNewOnly && filtered.some((p) => p.exported_at) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        resetExported.mutate(filtered.filter((p) => p.exported_at).map((p) => p.id))
                      }
                    >
                      Reset export status
                    </Button>
                  )}
                  <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
                    <Download className="h-4 w-4 mr-1" /> Export CSV
                  </Button>
                </div>

                {selected.size > 0 && (
                  <div className="flex items-center gap-2 bg-accent/60 border rounded-md px-3 py-1.5">
                    <span className="text-sm font-medium">
                      {selected.size} selected
                    </span>
                    <OwnerCombobox
                      owners={(owners ?? []) as OwnerLite[]}
                      associations={(associations ?? []) as AssociationLite[]}
                      value={null}
                      onChange={(ownerId) => bulkAssign.mutate({ ids: Array.from(selected), ownerId })}
                      placeholder="Assign to…"
                      className="min-w-56"
                    />
                    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                      Clear
                    </Button>
                  </div>
                )}
              </div>

              <Card className="overflow-x-auto hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allVisibleSelected}
                          onCheckedChange={toggleAll}
                          aria-label="Select all"
                        />
                      </TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Payer</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Condo</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Match</TableHead>
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
                          {showUnmatchedOnly ? "Nothing needs attention." : "No income payments yet."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((p) => <PaymentTableRow key={p.id} {...paymentProps(p)} />)
                    )}
                  </TableBody>
                </Table>
              </Card>

              {isLoading ? (
                <p className="text-center text-muted-foreground py-8 md:hidden">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="text-center text-muted-foreground py-8 md:hidden">
                  {showUnmatchedOnly ? "Nothing needs attention." : "No income payments yet."}
                </p>
              ) : (
                <MobileCardList>
                  {filtered.map((p) => (
                    <PaymentMobileCard key={p.id} {...paymentProps(p)} />
                  ))}
                </MobileCardList>
              )}
            </>
          );
        })()}
    </AppShell>
  );
}

// ── Email inbound helper panel ───────────────────────────────────────────────

const INBOUND_EMAIL = import.meta.env.VITE_INBOUND_EMAIL as string | undefined;

function EmailInboundPanel() {
  const [open, setOpen] = useState(false);
  const { data: allowedSenders } = useQuery({
    queryKey: ["allowed-sender-emails"],
    queryFn: async () => {
      const { data, error } = await supabase.from("allowed_sender_emails").select("email").order("created_at");
      if (error) throw error;
      return data as { email: string }[];
    },
  });

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
            <span className="font-medium text-foreground">"income"</span>,{" "}
            <span className="font-medium text-foreground">"payment"</span>, or{" "}
            <span className="font-medium text-foreground">"received"</span> somewhere in the
            email subject line — that's how it's told apart from a regular expense receipt. Only emails
            sent from{" "}
            <span className="font-medium text-foreground">
              {allowedSenders && allowedSenders.length > 0
                ? allowedSenders.map((s) => s.email).join(", ")
                : "an address configured in Settings"}
            </span>{" "}
            are processed. Manage allowed senders in{" "}
            <Link to="/settings" className="underline">
              Settings
            </Link>
            .
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
