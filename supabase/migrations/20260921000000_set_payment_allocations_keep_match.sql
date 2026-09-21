-- income_payments.condominium_id is NOT a mirror of the allocations, despite
-- being described as one when splitting shipped. matchOwner returns an
-- association with a NULL owner in two of its three paths (see
-- src/lib/extraction/owner-matching.ts) -- the AI can recognise which
-- association a payment belongs to without identifying which owner paid, and
-- this column is the only record of that.
--
-- set_payment_allocations did not know this and wrote condominium_id = NULL
-- whenever a payment had zero allocations. So assigning an owner to such a
-- payment and then clearing it destroyed a match nothing else holds, and the
-- outbound feed then sent that payment to CondoTracker with no association.
--
-- Ingest owns this column. The RPC must not touch it. Per-slice association
-- lives on income_payment_allocations.condominium_id, which the RPC still
-- derives from the owner.
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

  -- owner_id IS a true mirror of the single-allocation case, retained only so
  -- anything outside this codebase keeps working. Nothing in the app reads it.
  SELECT count(*) INTO v_count
  FROM public.income_payment_allocations WHERE payment_id = p_payment_id;

  IF v_count = 1 THEN
    SELECT owner_id INTO STRICT v_owner
    FROM public.income_payment_allocations WHERE payment_id = p_payment_id;
  ELSE
    v_owner := NULL;
  END IF;

  UPDATE public.income_payments
  SET owner_id = v_owner,
      allocations_updated_at = now()
  WHERE id = p_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_payment_allocations(UUID, JSONB) TO anon, authenticated;

-- Recover what the old behaviour destroyed, where it can be recovered: an
-- allocation kept its own condominium_id even when the payment's was nulled.
-- A payment that never had an allocation cannot be recovered -- that match is
-- already gone.
UPDATE public.income_payments p
SET condominium_id = a.condominium_id
FROM (
  SELECT DISTINCT ON (payment_id) payment_id, condominium_id
  FROM public.income_payment_allocations
  WHERE condominium_id IS NOT NULL
  ORDER BY payment_id, created_at
) a
WHERE a.payment_id = p.id AND p.condominium_id IS NULL;

-- Post-apply verification, must return t:
--   SELECT NOT EXISTS (
--     SELECT 1 FROM public.income_payments p
--     JOIN public.income_payment_allocations a ON a.payment_id = p.id
--     WHERE p.condominium_id IS NULL AND a.condominium_id IS NOT NULL
--   ) AS every_recoverable_match_restored;
