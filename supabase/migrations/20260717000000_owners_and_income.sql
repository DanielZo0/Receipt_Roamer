-- Owners (condo residents) and income payments (owner contribution payments).

CREATE TABLE public.owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id UUID REFERENCES public.associations(id),
  name TEXT NOT NULL,
  apartment TEXT,
  email TEXT,
  phone TEXT,
  id_number TEXT,
  yearly_contribution NUMERIC(14,2),
  contribution_paid BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  vat_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owners TO anon, authenticated;
ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read owners" ON public.owners FOR SELECT USING (true);
CREATE POLICY "Public insert owners" ON public.owners FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update owners" ON public.owners FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete owners" ON public.owners FOR DELETE USING (true);
CREATE INDEX owners_condominium_idx ON public.owners(condominium_id);

CREATE TABLE public.income_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES public.owners(id) ON DELETE SET NULL,
  condominium_id UUID REFERENCES public.associations(id),
  payer_name TEXT,
  amount NUMERIC(14,2),
  currency TEXT,
  payment_date DATE,
  reference_string TEXT,
  match_confidence NUMERIC,
  match_signals TEXT[],
  file_path TEXT,
  file_mime TEXT,
  raw_extraction JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.income_payments TO anon, authenticated;
ALTER TABLE public.income_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read income_payments" ON public.income_payments FOR SELECT USING (true);
CREATE POLICY "Public insert income_payments" ON public.income_payments FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update income_payments" ON public.income_payments FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete income_payments" ON public.income_payments FOR DELETE USING (true);
CREATE INDEX income_payments_owner_idx ON public.income_payments(owner_id);
CREATE INDEX income_payments_condominium_idx ON public.income_payments(condominium_id);
