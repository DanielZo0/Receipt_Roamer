-- Replaces a payment's allocations and refreshes the legacy mirror columns in
-- one statement. p_allocations is a JSON array of
--   { "owner_id": uuid|null, "condominium_id": uuid|null, "amount": numeric|null }
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
  SET owner_id = v_owner, condominium_id = v_condo
  WHERE id = p_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_payment_allocations(UUID, JSONB) TO anon, authenticated;

-- Post-apply verification (substitute real ids), each must return t:
--   SELECT public.set_payment_allocations('<payment>',
--     '[{"owner_id":"<owner-a>","condominium_id":"<condo>","amount":300},
--       {"owner_id":"<owner-b>","condominium_id":"<condo>","amount":250}]'::jsonb);
--   SELECT owner_id IS NULL AS mirror_cleared FROM public.income_payments WHERE id = '<payment>';
--   SELECT count(*) = 2 AS two_allocations FROM public.income_payment_allocations WHERE payment_id = '<payment>';
--
--   SELECT public.set_payment_allocations('<payment>',
--     '[{"owner_id":"<owner-a>","condominium_id":"<condo>","amount":550}]'::jsonb);
--   SELECT owner_id = '<owner-a>' AS mirror_restored FROM public.income_payments WHERE id = '<payment>';
--
--   -- condominium_id is derived from the owner, not taken from the caller:
--   SELECT public.set_payment_allocations('<payment>',
--     '[{"owner_id":"<owner-in-condo-A>","condominium_id":"<condo-B>","amount":550}]'::jsonb);
--   SELECT condominium_id = '<condo-A>' AS condo_derived_from_owner
--     FROM public.income_payment_allocations WHERE payment_id = '<payment>';
