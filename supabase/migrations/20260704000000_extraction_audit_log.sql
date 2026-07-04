CREATE TABLE public.extraction_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  file_name TEXT,

  -- Extracted values (post Phase 1 / Phase 4, whichever ran last)
  extracted_supplier TEXT,
  extracted_expense_date TEXT,
  extracted_amount NUMERIC,
  extracted_currency TEXT,
  extracted_category TEXT,
  extracted_association_id UUID,

  -- Which pipeline phase produced the final result
  phase TEXT NOT NULL,  -- "llm_extraction" | "llm_recheck"

  -- Phase 2: deterministic validation results (JSON array of ValidationError, null if none)
  validation_errors JSONB,
  validation_warnings JSONB,

  -- Phase 3: rule-based association matching results
  association_match_confidence NUMERIC(4, 3),  -- 0.0 to 1.0
  association_match_signals TEXT[],

  -- LLM usage (cumulative across phase 1 + phase 4 re-check, if it ran)
  llm_model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd NUMERIC(10, 6),

  -- Reasoning and full trace
  extraction_reasoning TEXT,
  pipeline_trace JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.extraction_audit_log TO anon, authenticated;
GRANT ALL ON public.extraction_audit_log TO service_role;

ALTER TABLE public.extraction_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read extraction_audit_log"   ON public.extraction_audit_log FOR SELECT USING (true);
CREATE POLICY "Public insert extraction_audit_log" ON public.extraction_audit_log FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update extraction_audit_log" ON public.extraction_audit_log FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete extraction_audit_log" ON public.extraction_audit_log FOR DELETE USING (true);

CREATE INDEX extraction_audit_log_expense_id_idx ON public.extraction_audit_log(expense_id);
CREATE INDEX extraction_audit_log_phase_idx ON public.extraction_audit_log(phase);
CREATE INDEX extraction_audit_log_created_at_idx ON public.extraction_audit_log(created_at DESC);
