-- condotracker_id was typed UUID on the assumption that CondoTracker's ids
-- are always well-formed UUIDs. They aren't: CondoTracker's id column is
-- varchar with a gen_random_uuid() default, but nothing enforces the format,
-- and at least one existing condominium has a hand-assigned id like
-- "condo_1772372892334". The sync failed inserting it with "invalid input
-- syntax for type uuid". Widen to text to accept whatever CondoTracker
-- actually stores, matching its own column type.
ALTER TABLE public.associations ALTER COLUMN condotracker_id TYPE text USING condotracker_id::text;
ALTER TABLE public.owners ALTER COLUMN condotracker_id TYPE text USING condotracker_id::text;
