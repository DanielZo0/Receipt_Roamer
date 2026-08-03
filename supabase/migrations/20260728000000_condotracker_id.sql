-- Stable linking columns for the read-only CondoTracker sync, so future syncs
-- upsert by CondoTracker's own id instead of fuzzy name matching.

ALTER TABLE public.associations ADD COLUMN condotracker_id UUID UNIQUE;
ALTER TABLE public.owners ADD COLUMN condotracker_id UUID UNIQUE;
