-- Backfill: 20260705000000_duplicate_detection_and_category_rules.sql was never
-- applied to this database, leaving extraction_audit_log.possible_duplicate_of
-- and the category_rules table missing. Written idempotently so it's safe to
-- run even if some pieces already exist.

ALTER TABLE public.extraction_audit_log
  ADD COLUMN IF NOT EXISTS possible_duplicate_of UUID REFERENCES public.expenses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS extraction_audit_log_possible_duplicate_of_idx
  ON public.extraction_audit_log(possible_duplicate_of);

CREATE TABLE IF NOT EXISTS public.category_rules (
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'category_rules' AND policyname = 'Public read category_rules') THEN
    CREATE POLICY "Public read category_rules"   ON public.category_rules FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'category_rules' AND policyname = 'Public insert category_rules') THEN
    CREATE POLICY "Public insert category_rules" ON public.category_rules FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'category_rules' AND policyname = 'Public update category_rules') THEN
    CREATE POLICY "Public update category_rules" ON public.category_rules FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'category_rules' AND policyname = 'Public delete category_rules') THEN
    CREATE POLICY "Public delete category_rules" ON public.category_rules FOR DELETE USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS category_rules_active_idx ON public.category_rules(active);
