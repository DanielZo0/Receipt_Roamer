-- The outbound feed pages incrementally on a timestamp. An allocated payment can
-- use its allocation's updated_at, but when a split is cleared the allocations are
-- deleted and nothing is left to carry the change -- the payment would fall back to
-- its original created_at and never be re-sent, stranding the superseded items in
-- CondoTracker. This column records when a payment's allocation set last changed,
-- and survives the rows themselves being removed.
ALTER TABLE public.income_payments
  ADD COLUMN IF NOT EXISTS allocations_updated_at TIMESTAMPTZ;

-- Replaces a payment's allocations and refreshes the legacy mirror columns in
-- one statement. p_allocations is a JSON array of
--   { "owner_id": uuid|null, "condominium_id": uuid|null, "amount": numeric|null }
--
-- Redefined here (CREATE OR REPLACE) only to also stamp allocations_updated_at,
-- so a cleared split still advances past the outbound feed's incremental cursor
-- even though the allocation rows themselves are deleted.
CREATE OR REPLACE FUNCTION public.set_payment_allocations(
  p_payment_id UUID,
  p_allocations JSONB
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_count INT;
  v_owner UUID;
  v_condo UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.income_payments WHERE id = p_payment_id) THEN
    RAISE EXCEPTION 'income_payments row % not found', p_payment_id;
  END IF;

  DELETE FROM public.income_payment_allocations WHERE payment_id = p_payment_id;

  -- condominium_id is derived from the owner rather than trusted from the
  -- caller: an allocation pointing at a condominium its owner does not belong
  -- to would silently misattribute money between associations. The client
  -- value is used only for a deliberately unattributed slice.
  INSERT INTO public.income_payment_allocations (payment_id, owner_id, condominium_id, amount)
  SELECT
    p_payment_id,
    parsed.owner_id,
    CASE WHEN parsed.owner_id IS NOT NULL THEN o.condominium_id ELSE parsed.condominium_id END,
    parsed.amount
  FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) AS a
  CROSS JOIN LATERAL (
    SELECT
      NULLIF(a->>'owner_id', '')::UUID AS owner_id,
      NULLIF(a->>'condominium_id', '')::UUID AS condominium_id,
      NULLIF(a->>'amount', '')::NUMERIC AS amount
  ) AS parsed
  LEFT JOIN public.owners o ON o.id = parsed.owner_id;

  -- Legacy mirror: populated only when there is exactly one allocation, so
  -- readers that still use income_payments.owner_id stay correct for the
  -- single-owner case and see NULL rather than a misleading owner for a split.
  SELECT count(*) INTO v_count
  FROM public.income_payment_allocations WHERE payment_id = p_payment_id;

  IF v_count = 1 THEN
    SELECT owner_id, condominium_id INTO STRICT v_owner, v_condo
    FROM public.income_payment_allocations WHERE payment_id = p_payment_id;
  ELSE
    v_owner := NULL;
    v_condo := NULL;
  END IF;

  UPDATE public.income_payments
  SET owner_id = v_owner,
      condominium_id = v_condo,
      allocations_updated_at = now()
  WHERE id = p_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_payment_allocations(UUID, JSONB) TO anon, authenticated;

-- Backfill: without this, the first outbound feed run after this migration
-- would treat allocations_updated_at IS NULL as "never changed" and fall back
-- to created_at anyway for every pre-existing row, which is already the
-- current behavior -- so this simply gives every existing payment a starting
-- value to page from, matching what the feed already sends today.
UPDATE public.income_payments SET allocations_updated_at = created_at
WHERE allocations_updated_at IS NULL;

-- Post-apply verification (substitute real ids), each must return t:
--   SELECT public.set_payment_allocations('<payment>',
--     '[{"owner_id":"<owner-a>","condominium_id":"<condo>","amount":300}]'::jsonb);
--   SELECT allocations_updated_at > created_at AS touched
--     FROM public.income_payments WHERE id = '<payment>';
