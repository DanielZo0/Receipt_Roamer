-- Adds condominiums present in condominiums_export.json but missing from the
-- live associations table (needed so owners_export.json can be seeded with a
-- valid condominium_id for every owner). Names match condominiums_export.json
-- verbatim (trimmed) so the seed script's name-matching resolves them.
INSERT INTO public.associations (name) VALUES
  ('160, Birkirkara Road'),
  ('Alpha Garages'),
  ('Block D, Qormi'),
  ('Dowman Court'),
  ('Fantine'),
  ('Hacienda Court'),
  ('Juliani'),
  ('Leslie Flats'),
  ('Mandalay Court'),
  ('Monterosa Court'),
  ('Peprina Court'),
  ('Petunia Suites'),
  ('Primrose'),
  ('The Olives'),
  ('Waterside');
