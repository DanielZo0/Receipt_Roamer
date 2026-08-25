/**
 * src/lib/condotracker-feed.server.ts
 *
 * Read-only feed consumed by CondoTracker's nightly sync. CondoTracker polls
 * GET /api/condotracker-feed with a cursor and stages the results in its own
 * review queue, where a human approves or discards each one.
 *
 * Design notes:
 *   - Nothing here writes to Receipt Roamer. In particular `exported_at` is
 *     NOT touched: that column belongs to the CSV export button in
 *     src/routes/expenses.tsx, and sharing it would make the two features
 *     silently interfere. CondoTracker tracks its own cursor instead.
 *   - Rows are emitted with CondoTracker's OWN uuids (associations.condotracker_id,
 *     owners.condotracker_id, populated by the sync in condotracker-sync.ts), so
 *     CondoTracker never has to know about Receipt Roamer's id space.
 *   - `.server.ts` suffix is load-bearing: this module imports the service-role
 *     Supabase client and must never reach the client bundle.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Signed receipt URLs must outlive the poll interval. CondoTracker syncs
 *  daily and the queue is reviewed by hand, so a 5-minute TTL (what the app's
 *  own UI uses) would be expired by the time anyone looks at it. */
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;

export interface FeedItem {
  sourceId: string;
  sourceKind: "expense" | "income";
  condotrackerCondominiumId: string | null;
  amount: number | null;
  currency: string | null;
  date: string | null;
  supplier: string | null;
  category: string | null;
  reference: string | null;
  condotrackerOwnerId: string | null;
  ownerMatchConfidence: number | null;
  ownerMatchSignals: string[] | null;
  filePath: string | null;
  fileMime: string | null;
  fileUrl: string | null;
  sourceCreatedAt: string;
}

export interface FeedResponse {
  items: FeedItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** PostgREST embeds come back as an object or (defensively) a single-element
 *  array depending on how the relationship is inferred. */
function embeddedCondotrackerId(rel: unknown): string | null {
  const row = Array.isArray(rel) ? rel[0] : rel;
  if (!row || typeof row !== "object") return null;
  const value = (row as { condotracker_id?: unknown }).condotracker_id;
  return typeof value === "string" ? value : null;
}

export async function getPendingForCondoTracker(
  since: string,
  limit: number = DEFAULT_LIMIT,
): Promise<FeedResponse> {
  const capped = Math.min(Math.max(limit, 1), MAX_LIMIT);
  // Over-fetch by one on each stream so we can tell whether more rows remain
  // after merging and truncating the two kinds together.
  const perStream = capped + 1;

  const [expensesResult, incomeResult] = await Promise.all([
    supabaseAdmin
      .from("expenses")
      .select(
        "id, amount, currency, supplier, expense_date, category, reference_number, file_path, file_mime, created_at, associations(condotracker_id)",
      )
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(perStream),
    supabaseAdmin
      .from("income_payments")
      .select(
        "id, amount, currency, payer_name, payment_date, reference_string, match_confidence, match_signals, file_path, file_mime, created_at, associations(condotracker_id), owners(condotracker_id)",
      )
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(perStream),
  ]);

  if (expensesResult.error) {
    throw new Error(`Failed to read expenses: ${expensesResult.error.message}`);
  }
  if (incomeResult.error) {
    throw new Error(`Failed to read income_payments: ${incomeResult.error.message}`);
  }

  const expenses: FeedItem[] = (expensesResult.data ?? []).map((row) => ({
    sourceId: row.id,
    sourceKind: "expense" as const,
    condotrackerCondominiumId: embeddedCondotrackerId(row.associations),
    amount: row.amount,
    currency: row.currency,
    date: row.expense_date,
    supplier: row.supplier,
    category: row.category,
    reference: row.reference_number,
    condotrackerOwnerId: null,
    ownerMatchConfidence: null,
    ownerMatchSignals: null,
    filePath: row.file_path,
    fileMime: row.file_mime,
    fileUrl: null,
    sourceCreatedAt: row.created_at,
  }));

  const income: FeedItem[] = (incomeResult.data ?? []).map((row) => ({
    sourceId: row.id,
    sourceKind: "income" as const,
    condotrackerCondominiumId: embeddedCondotrackerId(row.associations),
    amount: row.amount,
    currency: row.currency,
    date: row.payment_date,
    supplier: row.payer_name,
    category: null,
    reference: row.reference_string,
    condotrackerOwnerId: embeddedCondotrackerId(row.owners),
    ownerMatchConfidence: row.match_confidence,
    ownerMatchSignals: row.match_signals,
    filePath: row.file_path,
    fileMime: row.file_mime,
    fileUrl: null,
    sourceCreatedAt: row.created_at,
  }));

  // Merge both kinds into one created_at-ordered stream so a single cursor can
  // advance across them without skipping rows.
  const merged = [...expenses, ...income].sort((a, b) =>
    a.sourceCreatedAt === b.sourceCreatedAt
      ? a.sourceId.localeCompare(b.sourceId)
      : a.sourceCreatedAt.localeCompare(b.sourceCreatedAt),
  );

  const hasMore = merged.length > capped;
  const items = merged.slice(0, capped);

  await attachSignedUrls(items);

  return {
    items,
    nextCursor: items.length > 0 ? items[items.length - 1].sourceCreatedAt : null,
    hasMore,
  };
}

/** The `receipts` bucket is private, so `file_path` is useless to CondoTracker
 *  on its own. Mint signed URLs in one batch rather than one call per row. */
async function attachSignedUrls(items: FeedItem[]): Promise<void> {
  const paths = [...new Set(items.map((i) => i.filePath).filter((p): p is string => !!p))];
  if (paths.length === 0) return;

  const { data, error } = await supabaseAdmin.storage
    .from("receipts")
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

  if (error) {
    // A receipt we can't sign is not worth failing the whole sync over --
    // CondoTracker still gets the transaction, just without the attachment.
    console.error("[condotracker-feed] Failed to sign receipt URLs:", error.message);
    return;
  }

  const byPath = new Map<string, string>();
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl && !entry.error) byPath.set(entry.path, entry.signedUrl);
  }
  for (const item of items) {
    if (item.filePath) item.fileUrl = byPath.get(item.filePath) ?? null;
  }
}
