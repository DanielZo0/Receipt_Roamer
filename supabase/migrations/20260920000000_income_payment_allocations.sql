-- Income payment allocations: one row per owner slice of an income payment, so a
-- single bank transfer can be split across several owners, or across several
-- flats (the `apartment` column on an owners row) belonging to one owner.
-- Additive only: income_payments.owner_id/condominium_id/amount are untouched
-- here and continue to reflect the single-allocation case for existing callers.

CREATE TABLE public.income_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.income_payments(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES public.owners(id) ON DELETE SET NULL,
  condominium_id UUID REFERENCES public.associations(id),
  amount NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.income_payment_allocations TO anon, authenticated;
ALTER TABLE public.income_payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read income_payment_allocations" ON public.income_payment_allocations FOR SELECT USING (true);
CREATE POLICY "Public insert income_payment_allocations" ON public.income_payment_allocations FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update income_payment_allocations" ON public.income_payment_allocations FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete income_payment_allocations" ON public.income_payment_allocations FOR DELETE USING (true);
CREATE INDEX income_payment_allocations_payment_idx ON public.income_payment_allocations(payment_id);
CREATE INDEX income_payment_allocations_owner_idx ON public.income_payment_allocations(owner_id);
CREATE INDEX income_payment_allocations_condominium_idx ON public.income_payment_allocations(condominium_id);
CREATE INDEX income_payment_allocations_updated_idx ON public.income_payment_allocations(updated_at);

-- Backfill: one allocation per already-matched payment. Additive only --
-- no existing income_payments row is modified or deleted.
INSERT INTO public.income_payment_allocations (payment_id, owner_id, condominium_id, amount)
SELECT id, owner_id, condominium_id, COALESCE(amount, 0)
FROM public.income_payments
WHERE owner_id IS NOT NULL;

-- Post-apply verification -- each must return t:
--   SELECT (SELECT count(*) FROM public.income_payment_allocations)
--        = (SELECT count(*) FROM public.income_payments WHERE owner_id IS NOT NULL) AS ok;
--   SELECT COALESCE((SELECT sum(amount) FROM public.income_payment_allocations), 0)
--        = COALESCE((SELECT sum(COALESCE(amount,0)) FROM public.income_payments WHERE owner_id IS NOT NULL), 0) AS ok;
--   SELECT NOT EXISTS (
--     SELECT 1 FROM public.income_payment_allocations a
--     JOIN public.income_payments p ON p.id = a.payment_id
--     WHERE a.owner_id IS DISTINCT FROM p.owner_id
--   ) AS ok;
