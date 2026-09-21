-- Rename, never drop: the column keeps all its data and every row it describes.
--
-- "condominium_id" on a payment read as "the association this money belongs to",
-- which is the question income_payment_allocations answers. Four separate bugs
-- during the splitting work came from code reaching for this column to decide
-- association or matched-ness. The column actually holds something narrower and
-- still useful: what the extraction matcher thought, recorded once at ingest and
-- meaningful precisely when no owner could be identified.
--
-- Naming it for what it is stops the confusion at its source.
ALTER TABLE public.income_payments
  RENAME COLUMN condominium_id TO matched_condominium_id;

-- Postgres rewrites a dependent view's stored parse tree on RENAME COLUMN, so
-- condotracker_income_feed keeps working untouched. It is recreated here anyway
-- so the definition on disk says what it reads, rather than silently diverging
-- from the migration that created it.
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

-- Unallocated: one item, full amount, no owner. The association comes from the
-- matcher's own guess, which is the only association information a payment with
-- no allocations has.
SELECT
  p.id::text, p.id::text, p.amount, p.currency, p.payment_date, p.payer_name,
  p.reference_string, p.match_confidence, p.match_signals, p.file_path,
  p.file_mime,
  GREATEST(p.created_at, COALESCE(p.allocations_updated_at, p.created_at)),
  assoc.condotracker_id, NULL
FROM public.income_payments p
LEFT JOIN public.associations assoc ON assoc.id = p.matched_condominium_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.income_payment_allocations a WHERE a.payment_id = p.id
);

GRANT SELECT ON public.condotracker_income_feed TO anon, authenticated, service_role;

-- Post-apply verification, each must return t:
--   SELECT EXISTS (SELECT 1 FROM information_schema.columns
--     WHERE table_name='income_payments' AND column_name='matched_condominium_id') AS renamed;
--   SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns
--     WHERE table_name='income_payments' AND column_name='condominium_id') AS old_name_gone;
--   SELECT count(DISTINCT source_group_id) = (SELECT count(*) FROM public.income_payments)
--     AS feed_covers_every_payment FROM public.condotracker_income_feed;
