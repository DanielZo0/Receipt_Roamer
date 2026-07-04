-- Phase 2: human-in-the-loop learning (see ADK-inspired extraction plan)

CREATE TABLE public.expense_corrections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  original_value TEXT,
  corrected_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_corrections TO anon, authenticated;
GRANT ALL ON public.expense_corrections TO service_role;

ALTER TABLE public.expense_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read expense_corrections"   ON public.expense_corrections FOR SELECT USING (true);
CREATE POLICY "Public insert expense_corrections" ON public.expense_corrections FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update expense_corrections" ON public.expense_corrections FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete expense_corrections" ON public.expense_corrections FOR DELETE USING (true);

CREATE INDEX expense_corrections_expense_id_idx ON public.expense_corrections(expense_id);

CREATE TABLE public.association_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_pattern TEXT NOT NULL,
  association_id UUID NOT NULL REFERENCES public.associations(id) ON DELETE CASCADE,
  source_expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supplier_pattern, association_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.association_rules TO anon, authenticated;
GRANT ALL ON public.association_rules TO service_role;

ALTER TABLE public.association_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read association_rules"   ON public.association_rules FOR SELECT USING (true);
CREATE POLICY "Public insert association_rules" ON public.association_rules FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update association_rules" ON public.association_rules FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete association_rules" ON public.association_rules FOR DELETE USING (true);

CREATE INDEX association_rules_active_idx ON public.association_rules(active);
