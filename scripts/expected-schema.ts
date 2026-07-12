// Hand-maintained list of tables/columns the app expects to exist, mirroring
// src/integrations/supabase/types.ts. Update this alongside types.ts whenever
// a migration adds, renames, or removes a column — it's the source of truth
// for `npm run db:check`, which diffs this against the live database to catch
// migrations that were added to the repo but never applied.
export const expectedSchema: { table: string; columns: string[] }[] = [
  {
    table: "associations",
    columns: ["id", "name", "address", "notes", "keywords", "created_at"],
  },
  {
    table: "expenses",
    columns: [
      "id",
      "association_id",
      "supplier",
      "expense_date",
      "amount",
      "currency",
      "category",
      "reference_number",
      "file_path",
      "file_mime",
      "raw_extraction",
      "ledger_group_id",
      "source_line_index",
      "created_at",
    ],
  },
  {
    table: "categories",
    columns: ["id", "name", "keywords", "created_at"],
  },
  {
    table: "upload_logs",
    columns: [
      "id",
      "file_name",
      "file_size",
      "file_mime",
      "status",
      "expense_id",
      "error_message",
      "input_tokens",
      "output_tokens",
      "estimated_cost_usd",
      "source",
      "created_at",
    ],
  },
  {
    table: "extraction_audit_log",
    columns: [
      "id",
      "expense_id",
      "file_name",
      "extracted_supplier",
      "extracted_expense_date",
      "extracted_amount",
      "extracted_currency",
      "extracted_category",
      "extracted_association_id",
      "extracted_reference_number",
      "phase",
      "validation_errors",
      "validation_warnings",
      "association_match_confidence",
      "association_match_signals",
      "llm_model",
      "input_tokens",
      "output_tokens",
      "estimated_cost_usd",
      "extraction_reasoning",
      "pipeline_trace",
      "possible_duplicate_of",
      "created_at",
    ],
  },
  {
    table: "expense_corrections",
    columns: ["id", "expense_id", "field", "original_value", "corrected_value", "created_at"],
  },
  {
    table: "association_rules",
    columns: [
      "id",
      "supplier_pattern",
      "association_id",
      "source_expense_id",
      "active",
      "created_at",
    ],
  },
  {
    table: "category_rules",
    columns: ["id", "supplier_pattern", "category", "source_expense_id", "active", "created_at"],
  },
];
