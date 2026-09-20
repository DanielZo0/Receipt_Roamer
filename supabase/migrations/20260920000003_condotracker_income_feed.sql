CREATE OR REPLACE VIEW public.condotracker_income_feed AS
-- Allocated: one row per allocation. source_id stays the bare payment id while
-- there is only one allocation, so nothing already sent to CondoTracker re-sends
-- under a new id. source_group_id is always the payment id, so CondoTracker can
-- replace a payment's whole set when a split is created, changed or cleared.
SELECT
  CASE
    WHEN (SELECT count(*) FROM public.income_payment_allocations x
          WHERE x.payment_id = a.payment_id) = 1
    THEN p.id::text
    ELSE p.id::text || ':' || a.id::text
  END                                  AS source_id,
  p.id::text                           AS source_group_id,
  a.amount                             AS amount,
  p.currency, p.payment_date, p.payer_name, p.reference_string,
  p.match_confidence, p.match_signals, p.file_path, p.file_mime,
  GREATEST(p.created_at, a.updated_at) AS source_created_at,
  assoc.condotracker_id                AS condotracker_condominium_id,
  o.condotracker_id                    AS condotracker_owner_id
FROM public.income_payment_allocations a
JOIN public.income_payments p       ON p.id = a.payment_id
LEFT JOIN public.associations assoc ON assoc.id = a.condominium_id
LEFT JOIN public.owners o           ON o.id = a.owner_id

UNION ALL

-- Unallocated: one item, full amount, no owner. Uses allocations_updated_at so a
-- payment whose split was just cleared still advances past the feed cursor.
SELECT
  p.id::text, p.id::text, p.amount, p.currency, p.payment_date, p.payer_name,
  p.reference_string, p.match_confidence, p.match_signals, p.file_path,
  p.file_mime,
  GREATEST(p.created_at, COALESCE(p.allocations_updated_at, p.created_at)),
  assoc.condotracker_id, NULL
FROM public.income_payments p
LEFT JOIN public.associations assoc ON assoc.id = p.condominium_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.income_payment_allocations a WHERE a.payment_id = p.id
);

GRANT SELECT ON public.condotracker_income_feed TO anon, authenticated, service_role;
