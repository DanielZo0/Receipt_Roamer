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
 *   - Every item carries a `sourceGroupId`. For income that is the payment id
 *     (even when the payment is split into several allocation items); for an
 *     expense it is just the expense's own id, since expenses are never split.
 *     The dedup key CondoTracker keys on is still (source_system, source_id),
 *     but the agreed contract is supersede-by-group: when a payment's set of
 *     items changes shape -- a split is created, re-split, or cleared -- every
 *     item CondoTracker previously staged for that group should be replaced by
 *     the new set, not merged with it. Prefix-matching source_id is fragile
 *     (ids can collide on separators), so the group id is sent explicitly
 *     instead of being inferred by CondoTracker.
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
  sourceGroupId: string;
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

/**
 * Rows created at or after `since`. The bound is inclusive on purpose: rows
 * inserted in the same transaction share an identical created_at, and an
 * exclusive bound would drop any that fell on the far side of a page boundary.
 * CondoTracker dedupes on (source_system, source_id), so re-sending a handful
 * of boundary rows each run is free, whereas skipping one loses it for good.
 */
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
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(perStream),
    supabaseAdmin
      .from("condotracker_income_feed")
      .select(
        "source_id, source_group_id, amount, currency, payer_name, payment_date, reference_string, match_confidence, match_signals, file_path, file_mime, source_created_at, condotracker_condominium_id, condotracker_owner_id",
      )
      .gte("source_created_at", since)
      .order("source_created_at", { ascending: true })
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
    sourceGroupId: row.id,
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
    // source_id/source_group_id come back typed as nullable because PostgREST
    // can't express view-column nullability, but the view's CASE and ::text
    // casts mean every row actually has both populated.
    sourceId: row.source_id as string,
    sourceGroupId: row.source_group_id as string,
    sourceKind: "income" as const,
    condotrackerCondominiumId: row.condotracker_condominium_id,
    amount: row.amount,
    currency: row.currency,
    date: row.payment_date,
    supplier: row.payer_name,
    category: null,
    reference: row.reference_string,
    condotrackerOwnerId: row.condotracker_owner_id,
    ownerMatchConfidence: row.match_confidence,
    ownerMatchSignals: row.match_signals,
    filePath: row.file_path,
    fileMime: row.file_mime,
    fileUrl: null,
    sourceCreatedAt: row.source_created_at as string,
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
