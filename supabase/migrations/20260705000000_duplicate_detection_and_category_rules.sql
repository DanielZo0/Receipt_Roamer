-- Feature: duplicate-receipt detection
ALTER TABLE public.extraction_audit_log
  ADD COLUMN possible_duplicate_of UUID REFERENCES public.expenses(id) ON DELETE SET NULL;

CREATE INDEX extraction_audit_log_possible_duplicate_of_idx
  ON public.extraction_audit_log(possible_duplicate_of);

-- Feature: category learned rules (mirrors association_rules)
CREATE TABLE public.category_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_pattern TEXT NOT NULL,
  category TEXT NOT NULL,
  source_expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supplier_pattern, category)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.category_rules TO anon, authenticated;
GRANT ALL ON public.category_rules TO service_role;

ALTER TABLE public.category_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read category_rules"   ON public.category_rules FOR SELECT USING (true);
CREATE POLICY "Public insert category_rules" ON public.category_rules FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update category_rules" ON public.category_rules FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete category_rules" ON public.category_rules FOR DELETE USING (true);

CREATE INDEX category_rules_active_idx ON public.category_rules(active);
