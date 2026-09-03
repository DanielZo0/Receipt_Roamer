-- Duplicate-association cleanup: many associations were created locally
-- (condotracker_id IS NULL) before the CondoTracker sync existed, and now
-- duplicate an association that CondoTracker has since synced in under a
-- new id. Deleting the local duplicates from the UI failed because
-- owners.condominium_id and income_payments.condominium_id reference
-- associations with the default ON DELETE action (RESTRICT), so any owner
-- or income row still pointing at a duplicate blocked the delete.
--
-- This migration re-points any owners/income_payments/expenses/association_rules
-- rows off of non-CondoTracker associations onto the matching CondoTracker
-- association (matched by name), then removes every association that isn't
-- linked to CondoTracker. It also relaxes the two blocking foreign keys to
-- ON DELETE SET NULL so this can't get stuck again.
--
-- Note: association_rules.association_id is ON DELETE CASCADE, so without
-- re-pointing it first, deleting a duplicate association would silently
-- drop its learned supplier-matching rules.

BEGIN;

-- Map each non-CondoTracker association to its CondoTracker duplicate (same
-- name, case/whitespace-insensitive), if one exists.
CREATE TEMP TABLE assoc_dupe_map AS
SELECT dup.id AS dupe_id, keep.id AS keep_id
FROM public.associations dup
JOIN public.associations keep
  ON keep.condotracker_id IS NOT NULL
 AND lower(trim(keep.name)) = lower(trim(dup.name))
WHERE dup.condotracker_id IS NULL;

-- Re-point owners onto the CondoTracker association where one matches,
-- otherwise unlink (NULL) so the delete below no longer conflicts.
UPDATE public.owners o
SET condominium_id = m.keep_id
FROM assoc_dupe_map m
WHERE o.condominium_id = m.dupe_id;

UPDATE public.owners o
SET condominium_id = NULL
FROM public.associations a
WHERE o.condominium_id = a.id
  AND a.condotracker_id IS NULL;

UPDATE public.income_payments ip
SET condominium_id = m.keep_id
FROM assoc_dupe_map m
WHERE ip.condominium_id = m.dupe_id;

UPDATE public.income_payments ip
SET condominium_id = NULL
FROM public.associations a
WHERE ip.condominium_id = a.id
  AND a.condotracker_id IS NULL;

UPDATE public.expenses e
SET association_id = m.keep_id
FROM assoc_dupe_map m
WHERE e.association_id = m.dupe_id;

-- association_rules has a UNIQUE (supplier_pattern, association_id); drop any
-- rule that would collide once re-pointed, keep the rest.
DELETE FROM public.association_rules ar
USING assoc_dupe_map m
WHERE ar.association_id = m.dupe_id
  AND EXISTS (
    SELECT 1 FROM public.association_rules ar2
    WHERE ar2.association_id = m.keep_id
      AND ar2.supplier_pattern = ar.supplier_pattern
  );

UPDATE public.association_rules ar
SET association_id = m.keep_id
FROM assoc_dupe_map m
WHERE ar.association_id = m.dupe_id;

-- Remove every association that isn't linked to CondoTracker.
DELETE FROM public.associations WHERE condotracker_id IS NULL;

DROP TABLE assoc_dupe_map;

-- Prevent this from recurring: a CondoTracker sync (or manual cleanup) that
-- removes an association should unlink owners/income rather than being
-- blocked by them.
ALTER TABLE public.owners
  DROP CONSTRAINT owners_condominium_id_fkey,
  ADD CONSTRAINT owners_condominium_id_fkey
    FOREIGN KEY (condominium_id) REFERENCES public.associations(id) ON DELETE SET NULL;

ALTER TABLE public.income_payments
  DROP CONSTRAINT income_payments_condominium_id_fkey,
  ADD CONSTRAINT income_payments_condominium_id_fkey
    FOREIGN KEY (condominium_id) REFERENCES public.associations(id) ON DELETE SET NULL;

COMMIT;
