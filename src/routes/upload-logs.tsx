import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppNav } from "@/components/AppNav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { extractAndSaveExpense } from "@/lib/expenses.functions";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  FileText,
  Image,
  Loader2,
  ReceiptText,
  TrendingUp,
  DollarSign,
  Mail,
} from "lucide-react";

export const Route = createFileRoute("/upload-logs")({
  head: () => ({
    meta: [
      { title: "Upload logs · Receipt Tracker" },
      { name: "description", content: "History of all receipt upload attempts, including AI extraction status and estimated Gemini API cost." },
    ],
  }),
  component: UploadLogsPage,
});

type LogRow = {
  id: string;
  file_name: string;
  file_size: number | null;
  file_mime: string | null;
  status: "success" | "error";
  expense_id: string | null;
  error_message: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  source: "upload" | "email" | null;
  created_at: string;
  expenses?: {
    supplier: string | null;
    amount: number | null;
    currency: string | null;
    expense_date: string | null;
  } | null;
};

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCost(cost: number | null): string {
  if (cost == null) return "—";
  if (cost < 0.001) return `<$0.001`;
  return `$${cost.toFixed(4)}`;
}

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? "currency" : "decimal",
      currency: currency ?? undefined,
    }).format(amount);
  } catch {
    return `${amount} ${currency ?? ""}`.trim();
  }
}

function FileTypeIcon({ mime }: { mime: string | null }) {
  if (mime?.startsWith("image/")) return <Image className="h-4 w-4 text-muted-foreground" />;
  return <FileText className="h-4 w-4 text-muted-foreground" />;
}

function StatCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4 flex items-start gap-3">
      <div className="rounded-md bg-primary/10 p-2">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </Card>
  );
}

function UploadLogsPage() {
  const qc = useQueryClient();
  const extractFn = useServerFn(extractAndSaveExpense);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  const { data: logs, isLoading } = useQuery<LogRow[]>({
    queryKey: ["upload-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("upload_logs")
        .select(`
          id, file_name, file_size, file_mime, status, expense_id,
          error_message, input_tokens, output_tokens, estimated_cost_usd, source, created_at,
          expenses ( supplier, amount, currency, expense_date )
        `)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as LogRow[];
    },
  });

  async function handleRetry(log: LogRow) {
    // Retry requires the original file — we can't recover the binary from the server.
    // Open a file picker so the user can re-select the file.
    const input = document.createElement("input");
    input.type = "file";
    input.accept = log.file_mime?.startsWith("image/") ? "image/*" : "application/pdf,image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      setRetrying((prev) => new Set(prev).add(log.id));
      try {
        const path = `${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
        const { error: upErr } = await supabase.storage
          .from("receipts")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;

        const b64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
          r.onerror = reject;
          r.readAsDataURL(file);
        });

        await extractFn({
          data: {
            file_path: path,
            file_name: file.name,
            file_size: file.size,
            file_mime: file.type,
            file_base64: b64,
          },
        });
        toast.success("Retry successful — expense saved");
        qc.invalidateQueries({ queryKey: ["upload-logs"] });
      } catch (e) {
        toast.error((e as Error).message || "Retry failed");
        qc.invalidateQueries({ queryKey: ["upload-logs"] });
      } finally {
        setRetrying((prev) => {
          const next = new Set(prev);
          next.delete(log.id);
          return next;
        });
      }
    };
    input.click();
  }

  // Compute summary stats
  const totalLogs = logs?.length ?? 0;
  const successCount = logs?.filter((l) => l.status === "success").length ?? 0;
  const failCount = logs?.filter((l) => l.status === "error").length ?? 0;
  const successRate = totalLogs > 0 ? Math.round((successCount / totalLogs) * 100) : 0;
  const totalCost = logs?.reduce((sum, l) => sum + (l.estimated_cost_usd ?? 0), 0) ?? 0;
  const totalTokens = logs?.reduce(
    (sum, l) => sum + (l.input_tokens ?? 0) + (l.output_tokens ?? 0),
    0,
  ) ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-1">Upload logs</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Every upload attempt — successful extractions and failures — with token usage and estimated Gemini API cost.
        </p>

        {/* Stats row */}
        {!isLoading && totalLogs > 0 && (
          <div className="grid sm:grid-cols-3 gap-3 mb-6">
            <StatCard
              icon={ReceiptText}
              label="Total uploads"
              value={String(totalLogs)}
              sub={`${successCount} succeeded · ${failCount} failed`}
            />
            <StatCard
              icon={TrendingUp}
              label="Success rate"
              value={`${successRate}%`}
              sub={`${totalTokens.toLocaleString()} tokens used`}
            />
            <StatCard
              icon={DollarSign}
              label="Est. total cost"
              value={totalCost < 0.001 ? "<$0.001" : `$${totalCost.toFixed(4)}`}
              sub="Gemini 2.5 Flash"
            />
          </div>
        )}

        {isLoading ? (
          <Card className="p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-2" />
            <p className="text-sm text-muted-foreground">Loading logs…</p>
          </Card>
        ) : totalLogs === 0 ? (
          <Card className="p-12 text-center">
            <ReceiptText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No uploads yet. Head to the Upload page to get started.</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left font-medium text-muted-foreground px-4 py-3 w-6"></th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">File</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">Supplier / Error</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">Amount</th>
                    <th className="text-right font-medium text-muted-foreground px-4 py-3">Tokens</th>
                    <th className="text-right font-medium text-muted-foreground px-4 py-3">Est. cost</th>
                    <th className="text-right font-medium text-muted-foreground px-4 py-3">Date</th>
                    <th className="px-4 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {logs!.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                      {/* Status icon */}
                      <td className="px-4 py-3">
                        {log.status === "success" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                      </td>

                      {/* File */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileTypeIcon mime={log.file_mime} />
                          <div className="min-w-0">
                            <p className="font-medium truncate max-w-[180px]" title={log.file_name}>
                              {log.file_name}
                            </p>
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs text-muted-foreground">{formatBytes(log.file_size)}</p>
                              {log.source === "email" && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                                  <Mail className="h-2.5 w-2.5" /> Email
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Supplier / Error */}
                      <td className="px-4 py-3">
                        {log.status === "success" ? (
                          <span className="truncate max-w-[160px] block">
                            {log.expenses?.supplier ?? <span className="text-muted-foreground">Unknown</span>}
                            {log.expenses?.expense_date && (
                              <span className="block text-xs text-muted-foreground">{log.expenses.expense_date}</span>
                            )}
                          </span>
                        ) : (
                          <span
                            className="text-destructive text-xs line-clamp-2 max-w-[200px]"
                            title={log.error_message ?? ""}
                          >
                            {log.error_message ?? "Unknown error"}
                          </span>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-3 font-mono">
                        {log.status === "success"
                          ? formatAmount(log.expenses?.amount ?? null, log.expenses?.currency ?? null)
                          : <span className="text-muted-foreground">—</span>}
                      </td>

                      {/* Tokens */}
                      <td className="px-4 py-3 text-right text-muted-foreground font-mono">
                        {log.input_tokens != null || log.output_tokens != null ? (
                          <span title={`In: ${log.input_tokens ?? 0} · Out: ${log.output_tokens ?? 0}`}>
                            {((log.input_tokens ?? 0) + (log.output_tokens ?? 0)).toLocaleString()}
                          </span>
                        ) : "—"}
                      </td>

                      {/* Cost */}
                      <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                        {formatCost(log.estimated_cost_usd)}
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">
                        {new Date(log.created_at).toLocaleDateString(undefined, {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                        <span className="block text-xs">
                          {new Date(log.created_at).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </td>

                      {/* Retry */}
                      <td className="px-4 py-3">
                        {log.status === "error" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={retrying.has(log.id)}
                            onClick={() => handleRetry(log)}
                            title="Retry — select the file again to re-process"
                          >
                            {retrying.has(log.id) ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
