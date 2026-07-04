
CREATE TABLE public.extraction_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  file_name TEXT,
  
  -- Extracted values
  extracted_supplier TEXT,
  extracted_expense_date TEXT,
  extracted_amount NUMERIC,
  extracted_currency TEXT,
  extracted_category TEXT,
  extracted_association_id UUID,
  
  -- Pipeline phases and decisions
  phase TEXT NOT NULL,  -- "deterministic_validation", "association_matching", "llm_extraction", "llm_recheck"
  
  -- Validation results (as JSON for flexibility)
  validation_errors JSONB,  -- null if no errors
  validation_warnings JSONB,  -- null if no warnings
  
  -- Association matching results
  association_match_confidence NUMERIC(4, 3),  -- 0.0 to 1.0
  association_match_signals TEXT[],  -- ["keyword_match", "postal_code_match", etc]
  
  -- LLM usage
  llm_model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd NUMERIC(10, 6),
  
  -- Reasoning and traces
  extraction_reasoning TEXT,  -- Why Gemini made its choices
  pipeline_trace JSONB,  -- Full trace of all decisions made
  
  -- Audit metadata
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
