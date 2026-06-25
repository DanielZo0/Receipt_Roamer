
CREATE TABLE public.associations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  notes TEXT,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.associations TO anon, authenticated;
GRANT ALL ON public.associations TO service_role;
ALTER TABLE public.associations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read associations" ON public.associations FOR SELECT USING (true);
CREATE POLICY "Public insert associations" ON public.associations FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update associations" ON public.associations FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete associations" ON public.associations FOR DELETE USING (true);

CREATE TABLE public.expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  association_id UUID REFERENCES public.associations(id) ON DELETE SET NULL,
  supplier TEXT,
  expense_date DATE,
  amount NUMERIC(14,2),
  currency TEXT,
  category TEXT,
  file_path TEXT,
  file_mime TEXT,
  raw_extraction JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO anon, authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read expenses" ON public.expenses FOR SELECT USING (true);
CREATE POLICY "Public insert expenses" ON public.expenses FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update expenses" ON public.expenses FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete expenses" ON public.expenses FOR DELETE USING (true);

CREATE INDEX expenses_association_idx ON public.expenses(association_id);
CREATE INDEX expenses_date_idx ON public.expenses(expense_date);
