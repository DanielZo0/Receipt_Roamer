import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AppNav } from "@/components/AppNav";
import { supabase } from "@/integrations/supabase/client";
import { extractAndSaveExpense } from "@/lib/expenses.functions";
import { toast } from "sonner";
import { Upload as UploadIcon, Loader2, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload receipt · Receipt Tracker" },
      { name: "description", content: "Upload a receipt or bill and extract its data automatically." },
    ],
  }),
  component: UploadPage,
});

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

function UploadPage() {
  const navigate = useNavigate();
  const extractFn = useServerFn(extractAndSaveExpense);
  const [status, setStatus] = useState<"idle" | "uploading" | "extracting" | "done">("idle");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error("File too large (max 15 MB)");
      return;
    }
    try {
      setStatus("uploading");
      const path = `${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
      const { error: upErr } = await supabase.storage
        .from("receipts")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      setStatus("extracting");
      const b64 = await fileToBase64(file);
      const saved = await extractFn({
        data: { file_path: path, file_mime: file.type, file_base64: b64 },
      });
      setSavedId(saved?.id ?? null);
      setStatus("done");
      toast.success("Receipt extracted and saved");
    } catch (e) {
      console.error(e);
      toast.error((e as Error).message || "Upload failed");
      setStatus("idle");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-2">Upload receipt</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Drop an image or PDF. AI will extract date, supplier, amount, and pick the best matching association.
        </p>

        {status === "done" ? (
          <Card className="p-8 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 mx-auto text-primary" />
            <h2 className="text-lg font-semibold">Saved!</h2>
            <div className="flex gap-2 justify-center">
              <Button
                onClick={() => {
                  setSavedId(null);
                  setStatus("idle");
                }}
              >
                Upload another
              </Button>
              <Button variant="outline" onClick={() => navigate({ to: "/expenses" })}>
                View expenses
              </Button>
            </div>
            {savedId && (
              <p className="text-xs text-muted-foreground">
                You can edit fields on the{" "}
                <Link to="/expenses" className="underline">
                  expenses page
                </Link>
                .
              </p>
            )}
          </Card>
        ) : (
          <Card
            className={`p-12 border-2 border-dashed text-center transition-colors ${
              dragOver ? "border-primary bg-accent" : "border-border"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f && status === "idle") handleFile(f);
            }}
          >
            {status === "idle" && (
              <>
                <UploadIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="mb-4 text-sm text-muted-foreground">
                  Drag a file here, or click to choose
                </p>
                <input
                  id="file-input"
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                <Button asChild>
                  <label htmlFor="file-input" className="cursor-pointer">
                    Choose file
                  </label>
                </Button>
              </>
            )}
            {(status === "uploading" || status === "extracting") && (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm font-medium">
                  {status === "uploading" ? "Uploading file…" : "Extracting data with AI…"}
                </p>
              </div>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}